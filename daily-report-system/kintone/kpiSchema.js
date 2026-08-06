// ============================================================
//  毎朝KPI報告アプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = 1日。毎朝の会（北野・阪本・角南・黒葛原）用。
//
//  ・広告費/売上のレポート（スクショ・CSV）を添付するエリア
//  ・媒体別の売上・広告費を数字で入れると、
//    合計 / 達成率 / 広告費率 が自動計算される
//  ・良かった施策 / 改善施策 / 翌日やること のPDCA欄
//
//  ★売上明細（自動取込）とは別アプリです。
//    こちらは「人が朝の会で使う」ための入力・添付の場所。
// ============================================================

export const APP_NAME = '毎朝KPI報告（広告費・売上）';

export const FIELDS = {
  report_date: {
    type: 'DATE',
    code: 'report_date',
    label: '日付',
    required: true,
    unique: true,
    defaultNowValue: true,
  },

  // ── 添付エリア ──
  file_ads: {
    type: 'FILE',
    code: 'file_ads',
    label: '📎 広告費レポート（各媒体のスクショ・CSV）',
  },
  file_sales: {
    type: 'FILE',
    code: 'file_sales',
    label: '📎 売上レポート（セラーセントラル・RMS等）',
  },
  file_other: {
    type: 'FILE',
    code: 'file_other',
    label: '📎 その他（アクセス・転換率・メモなど何でも）',
  },
  // ※作成後に kintone/updateKpiApp.js で追加した欄:
  //   file_stock: 📎 在庫レポート（カラー別在庫のスクショ・CSV）

  // ── 売上（円） ──
  s_rk: { type: 'NUMBER', code: 's_rk', label: '売上：楽天', unit: '円', unitPosition: 'AFTER', digit: true },
  s_az: { type: 'NUMBER', code: 's_az', label: '売上：Amazon', unit: '円', unitPosition: 'AFTER', digit: true },
  s_own: { type: 'NUMBER', code: 's_own', label: '売上：自社サイト', unit: '円', unitPosition: 'AFTER', digit: true },
  s_total: {
    type: 'CALC',
    code: 's_total',
    label: '売上合計（自動）',
    expression: 's_rk + s_az + s_own',
    format: 'NUMBER_DIGIT',
    unit: '円',
    unitPosition: 'AFTER',
  },
  target: {
    type: 'NUMBER',
    code: 'target',
    label: '日別目標（計画シートの値）',
    unit: '円',
    unitPosition: 'AFTER',
    digit: true,
  },
  achieve: {
    type: 'CALC',
    code: 'achieve',
    label: '達成率（自動）',
    expression: 'IF(target = 0, 0, ROUND(s_total / target * 100, 1))',
    unit: '%',
    unitPosition: 'AFTER',
  },

  // ── 広告費（円） ──
  a_gg: { type: 'NUMBER', code: 'a_gg', label: '広告費：Google', unit: '円', unitPosition: 'AFTER', digit: true },
  a_rk: { type: 'NUMBER', code: 'a_rk', label: '広告費：楽天（RPP等）', unit: '円', unitPosition: 'AFTER', digit: true },
  a_az: { type: 'NUMBER', code: 'a_az', label: '広告費：Amazon', unit: '円', unitPosition: 'AFTER', digit: true },
  a_meta: { type: 'NUMBER', code: 'a_meta', label: '広告費：Meta', unit: '円', unitPosition: 'AFTER', digit: true },
  a_total: {
    type: 'CALC',
    code: 'a_total',
    label: '広告費合計（自動）',
    expression: 'a_gg + a_rk + a_az + a_meta',
    format: 'NUMBER_DIGIT',
    unit: '円',
    unitPosition: 'AFTER',
  },
  a_ratio: {
    type: 'CALC',
    code: 'a_ratio',
    label: '広告費率（自動・目標15%以下）',
    expression: 'IF(s_total = 0, 0, ROUND(a_total / s_total * 100, 1))',
    unit: '%',
    unitPosition: 'AFTER',
  },

  // ── PDCA ──
  m_good: { type: 'MULTI_LINE_TEXT', code: 'm_good', label: '✅ 良かった施策' },
  m_improve: { type: 'MULTI_LINE_TEXT', code: 'm_improve', label: '⚠️ 改善施策' },
  m_next: { type: 'MULTI_LINE_TEXT', code: 'm_next', label: '➡️ 翌日実施する改善内容' },
};

/** 一覧: 今日 / 今月 / すべて */
export const VIEWS = {
  今月: {
    index: 0,
    type: 'LIST',
    name: '今月',
    fields: ['report_date', 's_total', 'achieve', 'a_total', 'a_ratio', 'm_next'],
    filterCond: 'report_date = THIS_MONTH()',
    sort: 'report_date desc',
  },
  すべて: {
    index: 1,
    type: 'LIST',
    name: 'すべて',
    fields: ['report_date', 's_rk', 's_az', 's_own', 's_total', 'a_total', 'a_ratio'],
    sort: 'report_date desc',
  },
};
