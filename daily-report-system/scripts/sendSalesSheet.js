// ============================================================
//  売上管理シート（Excel）を Chatwork に送る
// ------------------------------------------------------------
//  out/売上管理シート.xlsx を、要点をまとめた本文つきで投稿します。
//
//  実行:
//    npm run sheet:send
//    npm run sheet:send -- --dry-run   … 送らずに本文だけ表示
//
//  ※ 先に次の2つを実行してファイルを作っておくこと:
//      npm run dashboard:data
//      python3 scripts/buildSalesSheet.py
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { uploadChatworkFile } from '../lib/chatwork.js';
import { yen, deltaPct, formatDelta } from '../lib/salesValues.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHEET = path.join(ROOT, 'out', '売上管理シート.xlsx');
const DATA = path.join(ROOT, 'out', 'dashboard-data.json');

/** 本文（シートの中身が一目で分かる要約）を組み立てる */
export function buildMessage(data) {
  const daily = data.daily;
  const totals = daily.reduce(
    (s, d) => ({
      rakuten: s.rakuten + (d.sales.rakuten || 0),
      amazon: s.amazon + (d.sales.amazon || 0),
      own: s.own + (d.sales.own || 0),
      units: s.units + (d.units ? Object.values(d.units).reduce((a, b) => a + b, 0) : 0),
    }),
    { rakuten: 0, amazon: 0, own: 0, units: 0 }
  );
  const total = totals.rakuten + totals.amazon + totals.own;

  // 月ごとの日商平均（日数が違う月を比べられるようにする）
  const months = new Map();
  for (const d of daily) {
    const ym = d.date.slice(0, 7);
    const m = months.get(ym) ?? { days: 0, sum: 0 };
    m.days += 1;
    m.sum += (d.sales.rakuten || 0) + (d.sales.amazon || 0) + (d.sales.own || 0);
    months.set(ym, m);
  }
  const ordered = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const lines = [];
  lines.push(`📗 売上管理シート（${data.period.from} 〜 ${data.period.to}）`);
  lines.push('');
  lines.push(`期間合計　${yen(total)}　／　${daily.length}日分`);
  lines.push(`販売個数　${totals.units.toLocaleString('ja-JP')}個`);
  lines.push('');
  lines.push('【チャネル別】');
  for (const [label, v] of [['楽天', totals.rakuten], ['Amazon', totals.amazon], ['自社サイト', totals.own]]) {
    const share = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
    lines.push(`${label}　${yen(v)}　(${share}%)`);
  }
  lines.push('');

  if (ordered.length >= 2) {
    lines.push('【月別の日商平均】');
    for (const [ym, m] of ordered) {
      lines.push(`${Number(ym.slice(5))}月　${yen(m.sum / m.days)}/日　（${m.days}日分）`);
    }
    const [, prev] = ordered[ordered.length - 2];
    const [, cur] = ordered[ordered.length - 1];
    const p = deltaPct(cur.sum / cur.days, prev.sum / prev.days);
    if (p !== null) lines.push(`前月比　${formatDelta(p)}${p <= -10 ? ' ⚠️' : p >= 10 ? ' 🔺' : ''}`);
    lines.push('');
  }

  // 売れ筋（期間合計）
  const top = [...data.products]
    .map((p) => ({
      name: p.name,
      units: Object.values(p.units).reduce(
        (s, byDate) => s + Object.values(byDate).reduce((a, b) => a + b, 0),
        0
      ),
    }))
    .filter((p) => p.units > 0)
    .sort((a, b) => b.units - a.units)
    .slice(0, 5);
  if (top.length) {
    lines.push('【売れ筋 TOP5（期間合計）】');
    top.forEach((p, i) => lines.push(`${i + 1}. ${p.name}　${p.units.toLocaleString('ja-JP')}個`));
    lines.push('');
  }

  lines.push('【シートの中身】');
  lines.push('1. 日次サマリー … 日ごとの売上・アクセス・転換率・販売個数');
  lines.push('2. 商品別サマリー … 商品ごとのチャネル別販売個数と構成比');
  lines.push('3. 商品×日 個数 … 商品と日付のクロス集計');
  lines.push('4. 月次サマリー … 月ごとの集計と日商平均');
  lines.push('');
  lines.push('合計・前日比・構成比はすべて数式です。数字を直すと自動で計算し直されます。');

  if (data.issues?.length) {
    lines.push('');
    lines.push('【要確認】');
    for (const s of data.issues) lines.push(`・${s}`);
  }

  return lines.join('\n');
}

async function main() {
  const isDry = process.argv.includes('--dry-run');

  if (!fs.existsSync(DATA)) {
    throw new Error(`データがありません: ${DATA}\n  npm run dashboard:data を先に実行してください。`);
  }
  if (!fs.existsSync(SHEET)) {
    throw new Error(
      `シートがありません: ${SHEET}\n  python3 scripts/buildSalesSheet.py を先に実行してください。`
    );
  }

  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const message = buildMessage(data);
  const buffer = fs.readFileSync(SHEET);

  console.log(`シート: ${Math.round(buffer.length / 1024)}KB`);

  if (isDry) {
    console.log('\n--- [dry-run] 送信内容 ---\n' + message);
    return;
  }

  const r = await uploadChatworkFile({
    buffer,
    fileName: '売上管理シート.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    message,
  });
  console.log(r.skipped ? 'テストモードのため未送信（APP_ENV=production で送信）' : '✅ 送信しました');
}

// 直接実行されたときだけ動かす（テストから読み込めるようにするため）
if (process.argv[1] && process.argv[1].endsWith('sendSalesSheet.js')) {
  main().catch((e) => {
    console.error('送信エラー:', e.message);
    process.exit(1);
  });
}
