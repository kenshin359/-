// ============================================================
//  経費管理アプリ  フィールド定義
// ------------------------------------------------------------
//  法人カード・立替などの経費を、利用者ごとに1レコード=1件で記録するアプリ。
//  いままでLINEアルバム（明細スクショ＋手集計）でやっていた報告を置き換えます。
//  月1回、締め期間（前月22日〜当月21日）でPDFレポートを自動作成します。
// ============================================================

export const APP_NAME = '経費管理（法人カード・立替）';

// 利用者一覧（追加・変更はこの配列を直してアプリ更新）
export const MEMBERS = [
  '塚本代表',
  '北野取締役',
  '笹本CS責任者',
  '角南広告責任者',
  '阪本人事部長',
  '倉内SNS責任者',
  '内田バイト',
  '桝田バイト',
  '黒葛原LP責任者',
  '村田CS',
  '山本O2SNS',
  '内田SNS',
  '桝田SNS',
  '関本CS',
  '西岡社長室',
  '淵田社長室',
  'ミンジ社員LP',
  '三浦社員LP',
  '辰巳バイト',
  '杉本バイト',
  '村形バイト',
];

const drop = (code, label, options, extra = {}) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
  ...extra,
});

export const FIELDS = {
  expense_date: { type: 'DATE', code: 'expense_date', label: '利用日', required: true },
  member: drop('member', '利用者', MEMBERS, { required: true }),
  pay_method: drop('pay_method', '支払方法', [
    '法人カード',
    '個人立替',
    '現金',
    '銀行振込',
  ], { required: true, defaultValue: '法人カード' }),
  // 迷ったら「その他」のままでOK（金額と明細画像があれば集計できる運用）
  category: drop('category', '費目', [
    '広告・販促費',
    '交通費',
    '交際費・会議費',
    '消耗品・備品',
    '通信費',
    'サブスク・ツール',
    '外注費',
    '仕入・商品関連',
    'その他',
  ], { required: true, defaultValue: 'その他' }),
  amount: { type: 'NUMBER', code: 'amount', label: '金額（税込・円）', required: true },
  payee: { type: 'SINGLE_LINE_TEXT', code: 'payee', label: '支払先・店名' },
  detail: { type: 'MULTI_LINE_TEXT', code: 'detail', label: '内容・目的' },
  receipt: { type: 'FILE', code: 'receipt', label: '領収書・明細（画像/PDF）' },
  settled: drop('settled', '精算状況', ['未精算', '精算済み'], { defaultValue: '未精算' }),
};

export const VIEWS = {
  今月: {
    index: 0,
    type: 'LIST',
    name: '今月',
    fields: ['expense_date', 'member', 'pay_method', 'category', 'amount', 'payee', 'settled'],
    filterCond: 'expense_date = THIS_MONTH()',
    sort: 'expense_date desc',
  },
  先月: {
    index: 1,
    type: 'LIST',
    name: '先月',
    fields: ['expense_date', 'member', 'pay_method', 'category', 'amount', 'payee', 'settled'],
    filterCond: 'expense_date = LAST_MONTH()',
    sort: 'expense_date desc',
  },
  未精算のみ: {
    index: 2,
    type: 'LIST',
    name: '未精算のみ',
    fields: ['expense_date', 'member', 'pay_method', 'category', 'amount', 'payee', 'settled'],
    filterCond: 'settled in ("未精算")',
    sort: 'expense_date asc',
  },
  すべて: {
    index: 3,
    type: 'LIST',
    name: 'すべて',
    fields: ['expense_date', 'member', 'pay_method', 'category', 'amount', 'payee', 'detail', 'settled'],
    sort: 'expense_date desc',
  },
};

// ★kintoneの仕様: REPORTSのキーは name と完全一致させること（GAIA_IN07対策）
export const REPORTS = {
  '今月 利用者別の経費': {
    chartType: 'BAR',
    chartMode: 'NORMAL',
    index: 0,
    name: '今月 利用者別の経費',
    groups: [{ code: 'member' }],
    aggregations: [{ type: 'SUM', code: 'amount' }],
    filterCond: 'expense_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月 費目別の経費': {
    chartType: 'PIE',
    chartMode: 'NORMAL',
    index: 1,
    name: '今月 費目別の経費',
    groups: [{ code: 'category' }],
    aggregations: [{ type: 'SUM', code: 'amount' }],
    filterCond: 'expense_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
};
