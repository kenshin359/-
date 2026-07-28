// ============================================================
//  [APIサンプル] AI経営日報アプリへ保存だけを試す
// ------------------------------------------------------------
//  out/analysis-<date>.json（callClaude の出力）を Kintone へ保存します。
//
//  実行:  node scripts/saveAiReport.js --date=2026-07-28
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiReport, findAiReportByDate } from '../lib/kintone.js';
import { toAiReportRecord, formatLineReport } from '../lib/format.js';
import { resolveTargetDate } from '../lib/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const dateISO = resolveTargetDate();
  const p = path.join(ROOT, 'out', `analysis-${dateISO}.json`);
  if (!fs.existsSync(p)) throw new Error(`分析結果が見つかりません: ${p}（先に callClaude.js を実行）`);
  const analysis = JSON.parse(fs.readFileSync(p, 'utf8'));

  // 重複チェック（重複送信・重複生成の防止）
  const existing = await findAiReportByDate(dateISO);
  if (existing) {
    console.log(`⏭  ${dateISO} は既に存在（id=${existing.$id?.value}）。保存を中止します。`);
    return;
  }

  const lineText = formatLineReport(analysis, dateISO);
  const record = toAiReportRecord(analysis, dateISO, lineText);
  const r = await createAiReport(record);
  console.log(`保存完了 ✅  AI経営日報 id=${r.id} revision=${r.revision}`);
}

main().catch((e) => {
  console.error('保存エラー:', e.message);
  process.exit(1);
});
