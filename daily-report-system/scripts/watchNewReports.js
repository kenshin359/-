// ============================================================
//  日報の新規提出をLINEに即時通知する
// ------------------------------------------------------------
//  誰かが日報を提出したら、その内容をClaudeが読んで
//  「誰が・何をしたか・要注意か」を1通のLINEで知らせます。
//
//  実行:
//    npm run watch                 … 新しい提出をチェックして通知
//    npm run watch -- --init       … 初回設定（今ある分を"通知済み"にする）
//    npm run watch -- --dry-run    … 通知せず、何が送られるかだけ表示
//
//  定期実行:
//    このスクリプトを10分おきに実行すれば、実質リアルタイム通知になります。
//    （cron / n8n の Schedule Trigger など）
//
//  仕組み:
//    日報の画像1枚1枚に固有のIDがあります。それを state ファイルに記録し、
//    「まだ記録に無いもの＝新規提出」として検出します。
//    レコードの編集で日報が追加される構造でも、取りこぼしません。
//
//  ※ Kintone は読むだけ。一切変更しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllDailyReportRecords } from '../lib/kintone.js';
import { extractImageReports } from '../lib/extractImages.js';
import { downloadFileAsBase64, toMediaType } from '../lib/kintoneFile.js';
import { summarizeReportImage } from '../lib/claude.js';
import { pushLine } from '../lib/line.js';
import { optional } from '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, '..', 'state', 'seen-reports.json');

// 1回の実行で通知する上限（初回や大量投稿時にLINEを埋め尽くさないため）
const MAX_NOTIFY_PER_RUN = 10;

// ── 通知済みリストの読み書き ──────────────────────────────
function loadSeen() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return new Set(j.seen ?? []);
  } catch {
    return new Set(); // 初回はファイルが無い
  }
}

function saveSeen(seen) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), seen: [...seen] }, null, 1),
    'utf8'
  );
}

// ── 通知本文を組み立てる ──────────────────────────────────
function buildMessage(report, summary) {
  const who = report.reporter ?? '（氏名不明）';
  const team = report.team ? `（${report.team}）` : '';
  const head = summary?.urgent ? '🚨 要対応の日報が届きました' : '📝 日報が届きました';

  const lines = [`${head}（${report.date}）`, '', `${who}さん${team}`, ''];

  if (summary) {
    lines.push(`【要点】${summary.summary || '情報不足'}`);
    if (Array.isArray(summary.done) && summary.done.length) {
      lines.push('', '【完了】', ...summary.done.map((x) => `・${x}`));
    }
    if (Array.isArray(summary.tomorrow) && summary.tomorrow.length) {
      lines.push('', '【明日】', ...summary.tomorrow.map((x) => `・${x}`));
    }
    if (summary.urgent && summary.urgent_reason) {
      lines.push('', `⚠️ ${summary.urgent_reason}`);
    }
  } else {
    // Claude が使えない場合でも、提出された事実だけは知らせる
    lines.push('（内容の自動要約は未設定です）');
  }

  lines.push('', '詳細はKintoneをご確認ください。');
  return lines.join('\n');
}

// ── メイン ────────────────────────────────────────────────
async function main() {
  const isInit = process.argv.includes('--init');
  const isDry = process.argv.includes('--dry-run');

  console.log('日報の新規提出をチェックしています…');
  const records = await fetchAllDailyReportRecords();
  const all = extractImageReports(records);

  // 画像1枚＝1提出として、固有IDの一覧を作る
  const items = [];
  for (const r of all) {
    for (const f of r.files) {
      items.push({ id: f.key, report: r, file: f });
    }
  }
  console.log(`  日報 ${items.length} 件を確認`);

  const seen = loadSeen();
  const fresh = items.filter((x) => !seen.has(x.id));

  // ── 初回設定：今あるものを全部「通知済み」にする ──
  if (isInit) {
    for (const x of items) seen.add(x.id);
    saveSeen(seen);
    console.log(`\n✅ 初回設定が完了しました。既存の ${items.length} 件を通知済みにしました。`);
    console.log('   これ以降に提出されたものだけが通知されます。');
    return;
  }

  if (!fresh.length) {
    console.log('  新しい提出はありません。');
    return;
  }

  console.log(`\n🆕 新しい提出が ${fresh.length} 件あります`);

  // 大量にあるときは古い順に上限まで（残りは次回に回す）
  const targets = fresh.slice(0, MAX_NOTIFY_PER_RUN);
  if (fresh.length > MAX_NOTIFY_PER_RUN) {
    console.log(`  （今回は ${MAX_NOTIFY_PER_RUN} 件まで通知し、残りは次回に回します）`);
  }

  const hasClaude = !!optional('ANTHROPIC_API_KEY');
  if (!hasClaude) {
    console.log('  ⚠️ ANTHROPIC_API_KEY が未設定のため、要約なしで通知します。');
  }

  for (const x of targets) {
    const who = x.report.reporter ?? '（氏名不明）';
    console.log(`\n── ${x.report.date} ${who} ──`);

    // 1) 画像を読んで要約（失敗しても通知自体は行う）
    let summary = null;
    if (hasClaude) {
      try {
        const { base64 } = await downloadFileAsBase64(x.file.key);
        summary = await summarizeReportImage({
          base64,
          mediaType: toMediaType(x.file.type),
          reporter: x.report.reporter,
          team: x.report.team,
          date: x.report.date,
        });
        console.log(`  要約: ${summary.summary}`);
        if (summary.urgent) console.log(`  🚨 要対応: ${summary.urgent_reason}`);
      } catch (e) {
        console.warn(`  ⚠️ 要約に失敗（通知は続行）: ${e.message}`);
      }
    }

    // 2) LINE通知
    const text = buildMessage(x.report, summary);
    if (isDry) {
      console.log('  --- [dry-run] 送信内容 ---\n' + text.replace(/^/gm, '  '));
    } else {
      try {
        const r = await pushLine(text);
        console.log(r.skipped ? '  （テストモードのため未送信）' : '  ✅ LINE送信しました');
      } catch (e) {
        console.error(`  ❌ LINE送信に失敗: ${e.message}`);
        continue; // 送れなかったものは「通知済み」にしない（次回再送）
      }
    }

    // 3) 通知できたものだけ記録する
    if (!isDry) {
      seen.add(x.id);
      saveSeen(seen); // 1件ごとに保存（途中で落ちても重複送信しない）
    }
  }

  console.log('\n完了しました。');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
