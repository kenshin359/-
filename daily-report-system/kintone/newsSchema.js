// ============================================================
//  リベティ・デイリーニュース  フィールド定義
// ------------------------------------------------------------
//  毎朝11:10に「昨日の経営ニュース」が自動で1本投稿されるアプリ。
//  スタッフは一覧（カード型のニュースビュー）を開くだけで
//  売上・販売個数・転換率・広告費・良い広告/悪い広告が読めます。
//
//  ・1レコード = 1日分のニュース
//  ・書き込みは自動投稿のみ（人は読むだけでOK）
// ============================================================

export const APP_NAME = 'リベティ・デイリーニュース';

export const FIELDS = {
  news_date: {
    type: 'DATE',
    code: 'news_date',
    label: '対象日',
    required: true,
    unique: true,
  },
  judge: {
    type: 'DROP_DOWN',
    code: 'judge',
    label: '総合判定',
    options: {
      '🟢 好調': { label: '🟢 好調', index: '0' },
      '🟡 まずまず': { label: '🟡 まずまず', index: '1' },
      '🔴 要改善': { label: '🔴 要改善', index: '2' },
    },
  },
  headline: {
    type: 'SINGLE_LINE_TEXT',
    code: 'headline',
    label: '見出し',
    required: true,
  },
  sales_total: { type: 'NUMBER', code: 'sales_total', label: '売上（円）' },
  units_total: { type: 'NUMBER', code: 'units_total', label: '販売個数（個）' },
  adcost_total: { type: 'NUMBER', code: 'adcost_total', label: '広告費（円）' },
  ad_ratio: { type: 'NUMBER', code: 'ad_ratio', label: '広告費率（%）' },
  cvr_note: {
    type: 'SINGLE_LINE_TEXT',
    code: 'cvr_note',
    label: '転換率メモ（楽天/Amazon）',
  },
  good_ads: { type: 'MULTI_LINE_TEXT', code: 'good_ads', label: '🏆 良い広告' },
  bad_ads: { type: 'MULTI_LINE_TEXT', code: 'bad_ads', label: '⚠️ 悪い広告' },
  body: { type: 'MULTI_LINE_TEXT', code: 'body', label: '本文（ニュース記事）' },
};

export const VIEWS = {
  '新しい順': {
    index: 0,
    type: 'LIST',
    name: '新しい順',
    fields: ['news_date', 'judge', 'headline', 'sales_total', 'adcost_total'],
    sort: 'news_date desc',
  },
};
