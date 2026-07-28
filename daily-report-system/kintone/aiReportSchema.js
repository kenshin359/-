// ============================================================
//  AI経営日報アプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = 1日分の、Claude が生成した経営向けサマリー。
//  フィールドコードは lib/format.js（toAiReportRecord）と一致させること。
// ============================================================

export const APP_NAME = 'AI経営日報';

export const FIELDS = {
  target_date: {
    type: 'DATE', code: 'target_date', label: '対象日',
    required: true, unique: true, // 1日1レコード（重複生成防止）
  },
  overall_rating: {
    type: 'DROP_DOWN', code: 'overall_rating', label: '全体評価', required: false,
    options: {
      '🟢順調': { label: '🟢順調', index: '0' },
      '🟡要確認': { label: '🟡要確認', index: '1' },
      '🔴緊急': { label: '🔴緊急', index: '2' },
    },
  },
  conclusion: { type: 'MULTI_LINE_TEXT', code: 'conclusion', label: '本日の結論', required: false },
  achievements: { type: 'MULTI_LINE_TEXT', code: 'achievements', label: '重要成果', required: false },
  problems: { type: 'MULTI_LINE_TEXT', code: 'problems', label: '問題・トラブル', required: false },
  delays: { type: 'MULTI_LINE_TEXT', code: 'delays', label: '進捗遅延', required: false },
  approvals: { type: 'MULTI_LINE_TEXT', code: 'approvals', label: '承認依頼', required: false },
  ceo_items: { type: 'MULTI_LINE_TEXT', code: 'ceo_items', label: '社長確認事項', required: false },
  manager_items: { type: 'MULTI_LINE_TEXT', code: 'manager_items', label: '部長確認事項', required: false },
  tomorrow_priorities: { type: 'MULTI_LINE_TEXT', code: 'tomorrow_priorities', label: '明日の最優先事項', required: false },
  staff_summaries: { type: 'MULTI_LINE_TEXT', code: 'staff_summaries', label: 'スタッフ別要約', required: false },
  ai_analysis: { type: 'MULTI_LINE_TEXT', code: 'ai_analysis', label: 'AI分析', required: false },
  line_body: { type: 'MULTI_LINE_TEXT', code: 'line_body', label: 'LINE送信本文', required: false },
  line_sent_at: { type: 'DATETIME', code: 'line_sent_at', label: 'LINE送信日時', required: false },
  line_result: {
    type: 'DROP_DOWN', code: 'line_result', label: 'LINE送信結果', required: false,
    options: {
      '未送信': { label: '未送信', index: '0' },
      '送信成功': { label: '送信成功', index: '1' },
      '送信失敗': { label: '送信失敗', index: '2' },
    },
  },
  gen_status: {
    type: 'DROP_DOWN', code: 'gen_status', label: '生成ステータス', required: false,
    options: {
      '生成中': { label: '生成中', index: '0' },
      '生成成功': { label: '生成成功', index: '1' },
      '生成失敗': { label: '生成失敗', index: '2' },
    },
  },
  error_log: { type: 'MULTI_LINE_TEXT', code: 'error_log', label: 'エラーログ', required: false },
};
