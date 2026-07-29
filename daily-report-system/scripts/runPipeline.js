// ============================================================
//  定時パイプライン（ワークフロー①のローカル版・エンドツーエンド）
// ------------------------------------------------------------
//  Kintone取得 → Claude分析 → Kintone保存 → LINE通知 → 結果書き戻し
//  n8n を使わずローカル/サーバの cron でも回せます。
//
//  実行:  node scripts/runPipeline.js
//         node scripts/runPipeline.js --date=2026-07-28
//
//  エラー処理:
//   - 日報0件 → LINEに「本日の提出はありません」を送って正常終了
//   - 重複実行 → 同じ対象日のAI日報が既にあればスキップ（重複送信防止）
//   - Claude/JSONパース失敗 → 生成失敗として記録しLINEはスキップ
// ============================================================
import { fetchAllDailyReportRecords, createAiReport, updateAiReport, findAiReportByDate } from '../lib/kintone.js';
import { extractReports, filterByDate, buildInputFromExtracted } from '../lib/extractReports.js';
import { analyzeReports } from '../lib/claude.js';
import { formatCeoReport, formatLineReport, toAiReportRecord } from '../lib/format.js';
import { notify, describeResults } from '../lib/notify.js';
import { resolveTargetDate } from '../lib/date.js';
import { isProduction } from '../lib/env.js';

async function main() {
  const dateISO = resolveTargetDate();
  console.log(`\n===== Libetee AI日報パイプライン (${dateISO}) env=${isProduction() ? 'production' : 'test'} =====`);

  // 0) 重複実行チェック（同じ対象日が既にあれば止める）
  const existing = await findAiReportByDate(dateISO);
  if (existing) {
    console.log(`⏭  ${dateISO} のAI経営日報は既に存在します（id=${existing.$id?.value}）。重複送信を防ぐため終了します。`);
    return;
  }

  // 1) Kintone から全レコードを取得し、日付・氏名・本文に展開して対象日で絞る
  //    （日報アプリは日付がサブテーブル内にあり、kintoneのクエリでは絞れないため）
  const rawRecords = await fetchAllDailyReportRecords();
  const allReports = extractReports(rawRecords);
  const records = filterByDate(allReports, dateISO);
  console.log(`① 日報取得: レコード${rawRecords.length}件 → 日報${allReports.length}件 → ${dateISO}分 ${records.length}件`);

  // 1.5) 日報0件のハンドリング
  if (records.length === 0) {
    console.log('⚠ 本日の提出はありません。');
    await notify(`📊 Libetee 日報（${dateISO}）\n\n本日の日報提出はありませんでした。\n提出状況をご確認ください。`);
    // 記録だけ残す
    await createAiReport({
      target_date: { value: dateISO },
      gen_status: { value: '生成成功' },
      overall_rating: { value: '🟡要確認' },
      conclusion: { value: '本日の日報提出はありませんでした（情報不足）' },
      line_result: { value: isProduction() ? '送信成功' : '未送信' },
    });
    return;
  }

  // 2) Claude 分析
  const input = buildInputFromExtracted(dateISO, records);
  let analysis;
  try {
    analysis = await analyzeReports(input);
    console.log(`② Claude分析: 完了（結論 ${analysis?.conclusion?.status ?? '?'} / urgent=${analysis?.urgent}）`);
  } catch (e) {
    console.error('② Claude分析に失敗:', e.message);
    // 失敗を Kintone に記録して終了（LINEは送らない）
    await createAiReport({
      target_date: { value: dateISO },
      gen_status: { value: '生成失敗' },
      error_log: { value: `Claude分析失敗: ${e.message}\n${e.raw ? '--- raw ---\n' + String(e.raw).slice(0, 1000) : ''}` },
      line_result: { value: '未送信' },
    });
    process.exitCode = 1;
    return;
  }

  // 3) 表示用・LINE用テキストを生成
  const ceoText = formatCeoReport(analysis, dateISO);
  const lineText = formatLineReport(analysis, dateISO);

  // 4) Kintone（AI経営日報）へ保存
  const record = toAiReportRecord(analysis, dateISO, lineText);
  const created = await createAiReport(record);
  const aiId = created.id;
  console.log(`③ Kintone保存: AI経営日報 id=${aiId}`);

  // 5) LINE 通知（test 環境なら送信スキップ）
  let lineResult = '未送信';
  let sentAt = '';
  try {
    const { results, anySent } = await notify(lineText, { urgent: !!analysis.urgent });
    const reallySent = results.some((r) => r.ok && !r.skipped);
    lineResult = reallySent ? '送信成功' : '未送信';
    sentAt = reallySent ? new Date().toISOString() : '';
    console.log(`④ 通知: ${describeResults(results)}`);
    if (!anySent) throw new Error('すべての通知先で送信に失敗しました');
  } catch (e) {
    lineResult = '送信失敗';
    console.error('④ LINE通知に失敗:', e.message);
    await updateAiReport(aiId, {
      line_result: { value: '送信失敗' },
      error_log: { value: `LINE送信失敗: ${e.message}` },
    });
  }

  // 6) 送信結果を書き戻し
  const patch = { line_result: { value: lineResult } };
  if (sentAt) patch.line_sent_at = { value: sentAt };
  await updateAiReport(aiId, patch);
  console.log('⑤ 送信結果を書き戻し完了');

  console.log('\n──── 経営日報プレビュー ────\n' + ceoText + '\n');
  console.log('===== 完了 ✅ =====');
}

main().catch((e) => {
  console.error('パイプライン致命的エラー:', e.message);
  process.exit(1);
});
