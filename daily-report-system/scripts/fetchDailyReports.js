// ============================================================
//  [APIサンプル] スタッフ日報を取得する
// ------------------------------------------------------------
//  対象日の「提出済み」日報を Kintone から取得して表示（＆保存）します。
//
//  実行:  node scripts/fetchDailyReports.js            … 今日分
//         node scripts/fetchDailyReports.js --date=2026-07-28
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDailyReports } from '../lib/kintone.js';
import { buildAnalysisInput } from '../lib/normalize.js';
import { resolveTargetDate } from '../lib/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'out');

async function main() {
  const dateISO = resolveTargetDate();
  console.log(`対象日: ${dateISO} の日報を取得します…`);

  const records = await fetchDailyReports(dateISO);
  console.log(`取得件数: ${records.length} 件`);

  // 0件は正常系として扱う（後段でハンドリング）
  const input = buildAnalysisInput(dateISO, records);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `reports-${dateISO}.json`);
  fs.writeFileSync(outPath, JSON.stringify(input, null, 2), 'utf8');
  console.log(`保存: ${outPath}`);

  for (const r of input.reports) {
    console.log(`  - ${r.reporter ?? '(不明)'} / ${r.dept ?? '-'} / 完了率 ${r.completion_rate ?? '?'}% / 緊急度 ${r.urgency ?? '-'}`);
  }
}

main().catch((e) => {
  console.error('取得エラー:', e.message);
  process.exit(1);
});
