// ============================================================
//  [APIサンプル] スタッフ日報を取得する
// ------------------------------------------------------------
//  日報アプリの全レコードを取得し、「日付・氏名・本文」に展開して
//  対象日の分だけを表示・保存します。
//
//  リベティの日報アプリは 1レコード＝1チームの数日分で、日付が
//  サブテーブルの中にあるため、kintone のクエリでは絞り込めません。
//  そこで全件取得 → コード側で展開・絞り込み という流れにしています。
//
//  実行:  node scripts/fetchDailyReports.js            … 今日分
//         node scripts/fetchDailyReports.js --date=2026-07-01
//         node scripts/fetchDailyReports.js --all      … 全日付を一覧表示
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllDailyReportRecords } from '../lib/kintone.js';
import { extractReports, filterByDate, buildInputFromExtracted } from '../lib/extractReports.js';
import { resolveTargetDate } from '../lib/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'out');

async function main() {
  const showAll = process.argv.includes('--all');
  const dateISO = resolveTargetDate();

  console.log('日報アプリから全レコードを取得しています…');
  const rawRecords = await fetchAllDailyReportRecords();
  console.log(`  レコード数: ${rawRecords.length} 件`);

  const allReports = extractReports(rawRecords);
  console.log(`  → 日報として抽出: ${allReports.length} 件`);

  // --all なら日付ごとの件数を一覧表示（どの日にデータがあるか確認用）
  if (showAll) {
    const byDate = new Map();
    for (const r of allReports) {
      const k = r.date ?? '(日付不明)';
      byDate.set(k, (byDate.get(k) ?? 0) + 1);
    }
    console.log('\n日付ごとの件数:');
    for (const [d, n] of [...byDate.entries()].sort()) {
      console.log(`  ${d}  … ${n} 件`);
    }
    return;
  }

  const reports = filterByDate(allReports, dateISO);
  console.log(`\n対象日 ${dateISO}: ${reports.length} 件`);

  for (const r of reports) {
    const preview = r.text.replace(/\s+/g, ' ').slice(0, 40);
    console.log(`  - ${r.reporter ?? '(氏名不明)'} / ${r.team ?? '-'} : ${preview}…`);
  }

  if (reports.length === 0) {
    console.log('\n※ この日の日報はありません。--all でデータのある日付を確認できます。');
  }

  const input = buildInputFromExtracted(dateISO, reports);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `reports-${dateISO}.json`);
  fs.writeFileSync(outPath, JSON.stringify(input, null, 2), 'utf8');
  console.log(`\n保存: ${outPath}`);
}

main().catch((e) => {
  console.error('取得エラー:', e.message);
  process.exit(1);
});
