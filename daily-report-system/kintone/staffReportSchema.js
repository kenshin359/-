// ============================================================
//  スタッフ日報アプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = スタッフ1名の1日の日報。
//  フィールドコードは lib/normalize.js と一致させること。
//  ※ 表示名・型・必須・選択肢・入力例は docs/kintone-staff-report-app.md 参照。
// ============================================================

export const APP_NAME = 'スタッフ日報';

// kintone の form/fields.json へそのまま渡せる properties オブジェクト
export const FIELDS = {
  report_date: {
    type: 'DATE', code: 'report_date', label: '報告日',
    required: true, defaultNowValue: true, unique: false,
  },
  reporter: {
    // 報告者は「ユーザー選択」推奨（誰が出したか確実に残る）
    type: 'USER_SELECT', code: 'reporter', label: '報告者', required: true,
  },
  dept: {
    type: 'DROP_DOWN', code: 'dept', label: '部署', required: true,
    options: {
      '営業': { label: '営業', index: '0' },
      'EC運営': { label: 'EC運営', index: '1' },
      'マーケティング': { label: 'マーケティング', index: '2' },
      '商品部': { label: '商品部', index: '3' },
      'カスタマーサポート': { label: 'カスタマーサポート', index: '4' },
      '管理部': { label: '管理部', index: '5' },
    },
  },
  planned_tasks: { type: 'MULTI_LINE_TEXT', code: 'planned_tasks', label: '本日予定していた業務', required: false },
  done_tasks: { type: 'MULTI_LINE_TEXT', code: 'done_tasks', label: '本日完了した業務', required: false },
  completion_rate: {
    type: 'NUMBER', code: 'completion_rate', label: '完了率', required: false,
    unit: '%', unitPosition: 'AFTER', minValue: '0', maxValue: '100', digit: false,
  },
  kpi_actual: { type: 'MULTI_LINE_TEXT', code: 'kpi_actual', label: '数値実績', required: false },
  undone_tasks: { type: 'MULTI_LINE_TEXT', code: 'undone_tasks', label: '未完了業務', required: false },
  undone_reason: { type: 'MULTI_LINE_TEXT', code: 'undone_reason', label: '未完了理由', required: false },
  problems: { type: 'MULTI_LINE_TEXT', code: 'problems', label: '発生した問題・トラブル', required: false },
  requests_to_dept: { type: 'MULTI_LINE_TEXT', code: 'requests_to_dept', label: '他部署への依頼', required: false },
  confirm_items: { type: 'MULTI_LINE_TEXT', code: 'confirm_items', label: '社長・部長への確認事項', required: false },
  approval_request: { type: 'MULTI_LINE_TEXT', code: 'approval_request', label: '承認依頼', required: false },
  tomorrow_plan: { type: 'MULTI_LINE_TEXT', code: 'tomorrow_plan', label: '明日の予定', required: false },
  urgency: {
    type: 'DROP_DOWN', code: 'urgency', label: '緊急度', required: true,
    defaultValue: '通常',
    options: {
      '通常': { label: '通常', index: '0' },
      '要確認': { label: '要確認', index: '1' },
      '緊急': { label: '緊急', index: '2' },
    },
  },
  related_product: { type: 'SINGLE_LINE_TEXT', code: 'related_product', label: '関連商品', required: false },
  related_deal: { type: 'SINGLE_LINE_TEXT', code: 'related_deal', label: '関連案件', required: false },
  attachments: { type: 'FILE', code: 'attachments', label: '添付ファイル', required: false },
  submit_status: {
    type: 'DROP_DOWN', code: 'submit_status', label: '提出状況', required: true,
    defaultValue: '下書き',
    options: {
      '下書き': { label: '下書き', index: '0' },
      '提出済み': { label: '提出済み', index: '1' },
    },
  },
};
