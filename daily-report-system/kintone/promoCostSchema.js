// ============================================================
//  販促費管理（広告・案件・PR）アプリ  フィールド定義
// ------------------------------------------------------------
//  Google広告・TikTok広告・案件依頼費・テレビ出演費用・PRタイムズなど、
//  CSV自動集計に乗らない販促系の支出を1か所で管理するアプリ。
//  スタッフが発生の都度入力 → 毎朝の進捗シートに自動で載ります。
// ============================================================

export const APP_NAME = '販促費管理（広告・案件・PR）';

const drop = (code, label, options) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
});

export const FIELDS = {
  cost_date: { type: 'DATE', code: 'cost_date', label: '計上日（発生日）', required: true },
  // ★Google広告はCSV自動集計（11時の広告費レポート）で管理するため、
  //   二重計上を防ぐ目的でこのアプリの費目には含めない（案A運用）。
  category: drop('category', '費目', [
    'TikTok広告',
    '案件依頼費',
    'テレビ出演費用',
    'PRタイムズ',
    'その他',
  ]),
  amount: { type: 'NUMBER', code: 'amount', label: '金額（税込・円）', required: true },
  partner: { type: 'SINGLE_LINE_TEXT', code: 'partner', label: '支払先・相手' },
  product: { type: 'SINGLE_LINE_TEXT', code: 'product', label: '関連商品（任意）' },
  memo: { type: 'MULTI_LINE_TEXT', code: 'memo', label: '備考（内容・期間など）' },
};

export const VIEWS = {
  今月: {
    index: 0,
    type: 'LIST',
    name: '今月',
    fields: ['cost_date', 'category', 'amount', 'partner', 'product', 'memo'],
    filterCond: 'cost_date = THIS_MONTH()',
    sort: 'cost_date desc',
  },
  すべて: {
    index: 1,
    type: 'LIST',
    name: 'すべて',
    fields: ['cost_date', 'category', 'amount', 'partner', 'product', 'memo'],
    sort: 'cost_date desc',
  },
};
