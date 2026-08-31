// ============================================================
//  案件依頼アプリ  フィールド定義
// ------------------------------------------------------------
//  インフルエンサー案件・ギフティング・PRタイアップなどの
//  「依頼の受付〜投稿完了まで」を1レコードで管理するアプリ。
//  担当は社長室の西岡（既定値）。
//
//  ・選択式はドロップダウン（表記ゆれ防止・集計可能に）
//  ・商品名は売上明細と同じ表記（効果の突き合わせ用）
//  ・進行フローは docs/influencer-workflow.md の8ステップに対応
// ============================================================

export const APP_NAME = '案件依頼（インフルエンサー・PR管理）';

const drop = (code, label, options, defaultValue) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
  ...(defaultValue ? { defaultValue } : {}),
});

// 進行フロー（①案件確定 → ②発送先・サイズ確認 → ③発送予定＋初稿提出目安確認 →
// ④商品発送 → ⑤発送完了連絡＋制作指示 → ⑥初稿提出 → ⑦確認・修正 → ⑧投稿日確定）
export const STATUS_OPTIONS = [
  '依頼前',
  '依頼中（返事待ち）',
  '承諾',
  '発送先・サイズ確認中',
  '初稿提出目安 確認中',
  '商品発送済',
  '初稿待ち',
  '初稿確認・修正中',
  '投稿日調整中',
  '投稿待ち',
  '投稿済',
  '完了',
  '見送り',
];

// ⑤で送る制作指示文のひな形（prompts/influencer/ 配下）
export const PATTERN_OPTIONS = [
  '①顔ファン・ファッション系',
  '②バズ・CV型',
  '③フィード投稿',
  'その他',
];

// サイズの宿泊目安・容量は商品ごとに異なるため、ここでは S / M / L だけを持つ
// （具体値は prompts/influencer/README.md のサイズ表を参照）
export const SIZE_OPTIONS = ['S', 'M', 'L', '該当なし'];

export const STORY_OPTIONS = ['①投稿直後（商品リンク）', '②投稿直後（クーポン）', '③指定期間中'];

export const FIELDS = {
  request_date: {
    type: 'DATE',
    code: 'request_date',
    label: '依頼日',
    required: true,
    defaultNowValue: true,
  },
  tantou: drop('tantou', '担当者', ['西岡', '淵田', '角南', '黒葛原', 'その他'], '西岡'),
  kind: drop('kind', '案件種別', [
    'インフルエンサー投稿',
    'ギフティング（商品提供）',
    'PRタイアップ',
    'アンバサダー',
    'メディア掲載',
    'テレビ出演',
    'プレスリリース',
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

  status: drop('status', 'ステータス', STATUS_OPTIONS, '依頼前'),
  shipping: drop('shipping', 'サンプル発送', ['不要', '未発送', '発送済'], '不要'),

  // ── ②発送先・サイズ等の確認 ──
  size: drop('size', '紹介サイズ', SIZE_OPTIONS, undefined),

  // ── ③発送予定＋初稿提出目安の確認（案件確定後は必ず通す）──
  draft_eta: { type: 'DATE', code: 'draft_eta', label: '初稿提出目安（本人確認済）' },
  draft_eta_note: {
    type: 'SINGLE_LINE_TEXT',
    code: 'draft_eta_note',
    label: '初稿提出目安メモ（例: 商品到着後7日程度）',
  },

  // ── ④商品発送／⑤制作指示 ──
  ship_date: { type: 'DATE', code: 'ship_date', label: '発送日' },
  pattern: drop('pattern', '制作指示パターン', PATTERN_OPTIONS, undefined),

  // ── ⑥初稿提出／⑧投稿日確定 ──
  draft_date: { type: 'DATE', code: 'draft_date', label: '初稿受領日' },
  post_date: { type: 'DATE', code: 'post_date', label: '投稿確定日' },
  story: {
    type: 'CHECK_BOX',
    code: 'story',
    label: 'ストーリー投稿（全3回）',
    options: Object.fromEntries(STORY_OPTIONS.map((o, i) => [o, { label: o, index: String(i) }])),
  },

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
  '⏳ 初稿待ち': {
    index: 1,
    type: 'LIST',
    name: '⏳ 初稿待ち',
    fields: ['draft_eta', 'draft_eta_note', 'partner', 'product', 'size', 'pattern', 'ship_date', 'status', 'tantou'],
    filterCond: 'status in ("初稿提出目安 確認中", "商品発送済", "初稿待ち")',
    sort: 'draft_eta asc',
  },
  '⚠ 期日が近い（投稿待ちまで）': {
    index: 2,
    type: 'LIST',
    name: '⚠ 期日が近い（投稿待ちまで）',
    fields: ['due', 'partner', 'kind', 'product', 'status', 'tantou'],
    filterCond: 'due <= FROM_TODAY(7, DAYS) and status not in ("投稿済", "完了", "見送り")',
    sort: 'due asc',
  },
  すべて: {
    index: 3,
    type: 'LIST',
    name: 'すべて',
    fields: ['request_date', 'tantou', 'kind', 'partner', 'product', 'status', 'due'],
    sort: 'request_date desc',
  },
};
