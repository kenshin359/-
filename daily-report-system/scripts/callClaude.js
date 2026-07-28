// ============================================================
//  [APIサンプル] Claude 分析だけを単体で試す
// ------------------------------------------------------------
//  out/reports-<date>.json（fetch の出力）か samples を入力に、
//  Claude 分析結果を out/analysis-<date>.json に保存します。
//
//  実行:  node scripts/callClaude.js --date=2026-07-28
//         node scripts/callClaude.js --file=samples/sample-daily-reports.json
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeReports } from '../lib/claude.js';
import { formatCeoReport, formatLineReport } from '../lib/format.js';
import { resolveTargetDate } from '../lib/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadInput() {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  if (fileArg) {
    const p = path.resolve(ROOT, fileArg.slice('--file='.length));
    return { input: JSON.parse(fs.readFileSync(p, 'utf8')), source: p };
  }
  const dateISO = resolveTargetDate();
  const p = path.join(ROOT, 'out', `reports-${dateISO}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`入力が見つかりません: ${p}\n先に node scripts/fetchDailyReports.js を実行するか、--file= を指定してください。`);
  }
  return { input: JSON.parse(fs.readFileSync(p, 'utf8')), source: p };
}

async function main() {
  const { input, source } = loadInput();
  console.log(`入力: ${source}（${input.report_count ?? input.reports?.length ?? 0} 件）`);

  const analysis = await analyzeReports(input);
  const dateISO = input.dateISO ?? resolveTargetDate();

  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `analysis-${dateISO}.json`), JSON.stringify(analysis, null, 2), 'utf8');

  console.log('\n──── 経営日報 ────\n' + formatCeoReport(analysis, dateISO));
  console.log('\n──── LINE本文 ────\n' + formatLineReport(analysis, dateISO));
}

main().catch((e) => {
  console.error('Claude分析エラー:', e.message);
  if (e.raw) console.error('--- モデル生出力(先頭500字) ---\n' + String(e.raw).slice(0, 500));
  process.exit(1);
});
