// ============================================================
//  案件依頼アプリ  フィールド定義
// ------------------------------------------------------------
//  インフルエンサー案件・ギフティング・PRタイアップなどの
//  「依頼の受付〜投稿完了まで」を1レコードで管理するアプリ。
//  担当は社長室の西岡（既定値）。
//
//  ・選択式はドロップダウン（表記ゆれ防止・集計可能に）
//  ・商品名は売上明細と同じ表記（効果の突き合わせ用）
// ============================================================

export const APP_NAME = '案件依頼（インフルエンサー・PR管理）';

const drop = (code, label, options, defaultValue) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
  ...(defaultValue ? { defaultValue } : {}),
});

export const FIELDS = {
  request_date: {
    type: 'DATE',
    code: 'request_date',
    label: '依頼日',
    required: true,
    defaultNowValue: true,
  },
  tantou: drop('tantou', '担当者', ['西岡', '淵田', '角南', 'その他'], '西岡'),
  kind: drop('kind', '案件種別', [
    'インフルエンサー投稿',
    'ギフティング（商品提供）',
    'PRタイアップ',
    'アンバサダー',
    'メディア掲載',
    'その他',
  ], 'インフルエンサー投稿'),

  partner: {
    type: 'SINGLE_LINE_TEXT',
    code: 'partner',
    label: '相手（インフルエンサー名・会社名）',
    required: true,
  },
  account: {
    type: 'SINGLE_LINE_TEXT',
    code: 'account',
    label: 'アカウント（@付き・URL可）',
  },
  product: drop('product', '対象商品', [
    'スーツケースS',
    'スーツケースM',
    'スーツケースL',
    'クラシックアルミ',
    '多機能アルミ',
    '多機能PC',
    'ハンディファン(首振り)',
    'ハンディファン(スケルトン)',
    'クリップファン',
    'ミニハンディファン',
    'ツヤリスドライヤー',
    '圧縮バッグ',
    '電動洗顔ブラシ',
    '複数・その他',
  ], undefined),

  detail: { type: 'MULTI_LINE_TEXT', code: 'detail', label: '依頼内容（何をしてもらうか）' },
  fee: { type: 'SINGLE_LINE_TEXT', code: 'fee', label: '報酬・条件（例: 商品提供のみ／2万円＋商品）' },
  due: { type: 'DATE', code: 'due', label: '投稿予定日・期日' },

  status: drop('status', 'ステータス', [
    '依頼前',
    '依頼中（返事待ち）',
    '承諾',
    '商品発送済',
    '投稿待ち',
    '投稿済',
    '完了',
    '見送り',
  ], '依頼前'),
  shipping: drop('shipping', 'サンプル発送', ['不要', '未発送', '発送済'], '不要'),

  post_url: { type: 'LINK', code: 'post_url', label: '投稿URL（投稿されたら記入）', protocol: 'WEB' },
  memo: { type: 'MULTI_LINE_TEXT', code: 'memo', label: '備考' },
  file_anken: { type: 'FILE', code: 'file_anken', label: '📎 資料（DMのスクショ・条件書など）' },
};

export const VIEWS = {
  '進行中': {
    index: 0,
    type: 'LIST',
    name: '進行中',
    fields: ['request_date', 'tantou', 'kind', 'partner', 'product', 'status', 'due', 'shipping'],
    filterCond: 'status not in ("完了", "見送り")',
    sort: 'due asc',
  },
  '⚠ 期日が近い（投稿待ちまで）': {
    index: 1,
    type: 'LIST',
    name: '⚠ 期日が近い（投稿待ちまで）',
    fields: ['due', 'partner', 'kind', 'product', 'status', 'tantou'],
    filterCond: 'due <= FROM_TODAY(7, DAYS) and status not in ("投稿済", "完了", "見送り")',
    sort: 'due asc',
  },
  すべて: {
    index: 2,
    type: 'LIST',
    name: 'すべて',
    fields: ['request_date', 'tantou', 'kind', 'partner', 'product', 'status', 'due'],
    sort: 'request_date desc',
  },
};
