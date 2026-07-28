// ============================================================
//  Kintone レコード → Claude 入力用の正規化
// ------------------------------------------------------------
//  kintone のレコードは { field_code: { value } } という形。
//  そのままだと冗長なので、Claude が読みやすい素直な形に変換する。
//  フィールドコードは kintone/staffReportSchema.js と一致させること。
// ============================================================

// kintone フィールドの値を取り出す小ヘルパー（未定義に強い）
function v(record, code) {
  const f = record?.[code];
  if (!f) return null;
  const val = f.value;
  if (val === '' || val === undefined) return null;
  return val;
}

/**
 * スタッフ日報レコード1件を正規化する。
 * @param {object} record kintone レコード
 * @returns {object} 素直なオブジェクト
 */
export function normalizeReport(record) {
  return {
    report_date: v(record, 'report_date'),
    reporter: v(record, 'reporter'),
    dept: v(record, 'dept'),
    planned_tasks: v(record, 'planned_tasks'),
    done_tasks: v(record, 'done_tasks'),
    completion_rate: v(record, 'completion_rate'),
    kpi_actual: v(record, 'kpi_actual'),
    undone_tasks: v(record, 'undone_tasks'),
    undone_reason: v(record, 'undone_reason'),
    problems: v(record, 'problems'),
    requests_to_dept: v(record, 'requests_to_dept'),
    confirm_items: v(record, 'confirm_items'),
    approval_request: v(record, 'approval_request'),
    tomorrow_plan: v(record, 'tomorrow_plan'),
    urgency: v(record, 'urgency'),
    related_product: v(record, 'related_product'),
    related_deal: v(record, 'related_deal'),
    submit_status: v(record, 'submit_status'),
    // 添付ファイルはファイル名だけを渡す（本文はClaudeに送らない）
    attachments: (record?.attachments?.value ?? []).map((a) => a.name),
  };
}

/**
 * レコード配列 → { dateISO, reports } の入力データを組み立てる。
 * @param {string} dateISO
 * @param {Array} records
 * @param {Array} [previousIssues] 前日から継続確認したい課題（任意）
 */
export function buildAnalysisInput(dateISO, records, previousIssues = []) {
  return {
    dateISO,
    company: '株式会社リベティ (Libetee)',
    reports: records.map(normalizeReport),
    previousIssues,
    report_count: records.length,
  };
}
