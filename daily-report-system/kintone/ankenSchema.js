// ============================================================
//  案件報告（クリエイター配信管理）アプリ  フィールド定義
// ------------------------------------------------------------
//  Meta広告クリエイター配信管理シート（Excel）と同じ構成。
//  1レコード = クリエイター1名の案件。
//
//  ・選択式はすべてドロップダウン（表記ゆれをなくして集計可能に）
//  ・「配信可否 報告期限」は投稿日から自動計算（投稿日＋3日）
//  ・「利用可／利用不可」はこのアプリで一元管理（トラブル防止）
// ============================================================

export const APP_NAME = '案件報告（クリエイター配信管理）';

const drop = (code, label, options, defaultValue) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
  ...(defaultValue ? { defaultValue } : {}),
});

export const FIELDS = {
  creator_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'creator_name',
    label: '名前',
    required: true,
  },
  account_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'account_name',
    label: 'アカウント名（@付き）',
  },

  tieup: drop('tieup', 'タイアップ投稿', ['予定', '依頼済', '投稿済', '見送り'], '予定'),
  precheck: drop('precheck', '事前確認（Meta広告で配信OKか）', ['未確認', '確認中', 'OK', 'NG'], '未確認'),
  meta_ok: drop('meta_ok', 'Meta広告 利用可否', ['確認中', '利用可', '利用不可'], '確認中'),

  post_date: { type: 'DATE', code: 'post_date', label: '投稿日' },
  report_due: {
    type: 'CALC',
    code: 'report_due',
    label: '配信可否 報告期限（自動：投稿日＋3日）',
    expression: 'post_date + 259200',
    format: 'DATE',
  },
  report_done: drop('report_done', '配信可否 報告済', ['未', '済'], '未'),

  air_date: { type: 'DATE', code: 'air_date', label: '配信予定日' },
  aired: drop('aired', '配信済み', ['未', '済'], '未'),

  memo: { type: 'MULTI_LINE_TEXT', code: 'memo', label: '備考' },
};

/** 一覧: 要フォロー / 利用可 / すべて */
export const VIEWS = {
  '⚠ 要フォロー（報告待ち）': {
    index: 0,
    type: 'LIST',
    name: '⚠ 要フォロー（報告待ち）',
    fields: ['creator_name', 'account_name', 'tieup', 'post_date', 'report_due', 'report_done', 'meta_ok'],
    filterCond: 'tieup in ("投稿済") and report_done in ("未")',
    sort: 'post_date asc',
  },
  '利用可（配信できる）': {
    index: 1,
    type: 'LIST',
    name: '利用可（配信できる）',
    fields: ['creator_name', 'account_name', 'meta_ok', 'air_date', 'aired', 'memo'],
    filterCond: 'meta_ok in ("利用可")',
    sort: 'air_date asc',
  },
  すべて: {
    index: 2,
    type: 'LIST',
    name: 'すべて',
    fields: ['creator_name', 'account_name', 'tieup', 'precheck', 'meta_ok', 'post_date', 'report_done', 'air_date', 'aired'],
    sort: 'post_date desc',
  },
};
