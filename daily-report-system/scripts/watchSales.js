// ============================================================
//  売上が記載されたら通知する（分析＋簡易シート付き）
// ------------------------------------------------------------
//  Kintone の売上アプリに新しい日の報告が入ったら、
//  分析コメントを添えて Chatwork に通知し、
//  直近の数字をまとめた簡易シート（Excel）を添付します。
//
//  実行:
//    npm run watch:sales                 … 新しく入った日だけ通知
//    npm run watch:sales -- --init       … 既存を「通知済み」にする（初回）
//    npm run watch:sales -- --dry-run    … 送らずに内容だけ表示
//    npm run watch:sales -- --force      … 通知済みでも最新日を送る（動作確認用）
//
//  ★分析はすべてJS側の計算です。AIは使いません（費用ゼロ）。
//  ★Kintone は読むだけ。一切変更しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { fetchSalesApp, extractDailyRows } from '../lib/kintoneSalesDaily.js';
import { buildSalesAlert } from '../lib/salesAlert.js';
import { pushChatwork, uploadChatworkFile } from '../lib/chatwork.js';
import { optional } from '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, 'state', 'notified-sales.json');
const SHEET = path.join(ROOT, 'out', '売上簡易シート.xlsx');

function loadState() {
  if (!fs.existsSync(STATE)) return { dates: [] };
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return { dates: [] };
  }
}

function saveState(dates) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ dates: dates.slice(-400) }, null, 1), 'utf8');
}

/** 簡易シート（Excel）を作る。python 側に任せる */
function buildSheet(dateISO) {
  const r = spawnSync('python3', [path.join(ROOT, 'scripts', 'buildQuickSheet.py'), `--date=${dateISO}`], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.warn('  ⚠️ 簡易シートの作成に失敗しました（本文のみ送ります）');
    if (r.stderr) console.warn('    ' + r.stderr.trim().split('\n').slice(-3).join('\n    '));
    return null;
  }
  return fs.existsSync(SHEET) ? SHEET : null;
}

async function main() {
  const isDry = process.argv.includes('--dry-run');
  const isInit = process.argv.includes('--init');
  const isForce = process.argv.includes('--force');

  console.log('Kintone の売上アプリを確認します…');
  const rows = extractDailyRows(await fetchSalesApp());
  if (!rows.length) {
    console.log('  売上データがありません。');
    return;
  }

  const state = loadState();
  const notified = new Set(state.dates);
  const fresh = rows.filter((r) => !notified.has(r.date));

  console.log(`  登録済み: ${rows.length}日分 / 未通知: ${fresh.length}日分`);

  if (isInit) {
    saveState(rows.map((r) => r.date));
    console.log(`✅ 既存の${rows.length}日分を通知済みにしました。次から新しい日だけ通知します。`);
    return;
  }

  let targets = fresh;
  if (!targets.length) {
    if (!isForce) {
      console.log('新しく記載された売上はありません。');
      return;
    }
    targets = rows.slice(-1);
    console.log('  --force のため、最新日を送ります。');
  }

  // 新しい日が複数あっても、通知は最新の1日だけにする。
  // 過去分をまとめて流すと、どれが今日の数字か分からなくなるため。
  const target = targets[targets.length - 1];
  if (targets.length > 1) {
    console.log(`  ※ 未通知が${targets.length}日分ありますが、最新の ${target.date} を送ります。`);
  }

  const alert = buildSalesAlert(rows, target.date);
  console.log(`  対象日: ${target.date} / 売上 ¥${alert.today.total.toLocaleString('ja-JP')}`);

  if (isDry) {
    console.log('\n--- [dry-run] 送信内容 ---\n' + alert.text);
    return;
  }

  const room = optional('CHATWORK_SALES_ROOM_ID') || optional('CHATWORK_ROOM_ID');
  if (!room) {
    console.error('送信先が未設定です（CHATWORK_SALES_ROOM_ID または CHATWORK_ROOM_ID）');
    process.exit(1);
  }

  console.log('  簡易シートを作成中…');
  const sheet = buildSheet(target.date);

  let sent = false;
  if (sheet) {
    try {
      const buf = fs.readFileSync(sheet);
      const r = await uploadChatworkFile({
        buffer: buf,
        fileName: `売上簡易シート_${target.date}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        message: alert.text,
        roomId: room,
      });
      sent = !r.skipped;
      console.log(r.skipped ? '  テストモードのため未送信' : '  ✅ シート付きで送信しました');
    } catch (e) {
      // シートが送れなくても、数字だけは必ず届けたい
      console.warn(`  ⚠️ シートの送信に失敗: ${e.message}`);
    }
  }

  if (!sent) {
    const r = await pushChatwork(alert.text, { roomId: room, decorate: false });
    sent = !r.skipped;
    console.log(r.skipped ? '  テストモードのため未送信' : '  ✅ 本文のみ送信しました');
  }

  if (sent) {
    notified.add(target.date);
    saveState([...notified].sort());
  }
}

main().catch((e) => {
  console.error('売上通知 エラー:', e.message);
  process.exit(1);
});
