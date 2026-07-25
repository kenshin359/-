// 「売上日報（新）」アプリのフィールド定義。
// 仕様書（作り直し仕様書）のセクション3をそのままコード化したもの。
// kintone の「フィールド追加API」に渡す properties 形式（キー = フィールドコード）。

export const FIELDS = {
  // ── 日付 ──
  date: {
    type: 'DATE',
    code: 'date',
    label: '日付',
    required: true,
    unique: true, // 1日1レコードを担保
    defaultNowValue: false,
  },

  // ── 売上（円）──
  sales_rakuten: numberField('sales_rakuten', '楽天 売上', { unit: '円' }),
  sales_amazon: numberField('sales_amazon', 'Amazon 売上', { unit: '円' }),
  sales_own: numberField('sales_own', '自社サイト 売上', { unit: '円' }),
  sales_total: {
    type: 'CALC',
    code: 'sales_total',
    label: '合計売上',
    expression: 'sales_rakuten + sales_amazon + sales_own',
    format: 'NUMBER',
    displayScale: '0',
    unit: '円',
    unitPosition: 'AFTER',
  },

  // ── 楽天 指標 ──
  rk_access: numberField('rk_access', '楽天 アクセス数', {}),
  rk_cvr: numberField('rk_cvr', '楽天 転換率', { unit: '%', unitPosition: 'AFTER', displayScale: '2' }),
  rk_fav: numberField('rk_fav', '楽天 お気に入り登録数', {}),
  rk_stay: numberField('rk_stay', '楽天 滞在時間', { unit: '秒', unitPosition: 'AFTER' }),

  // ── Amazon 指標 ──
  az_access: numberField('az_access', 'Amazon アクセス数', {}),
  az_cvr: numberField('az_cvr', 'Amazon 転換率', { unit: '%', unitPosition: 'AFTER', displayScale: '2' }),

  // ── 商品別ランキング（テーブル）──
  ranking: {
    type: 'SUBTABLE',
    code: 'ranking',
    label: '商品別ランキング',
    fields: {
      mall: {
        type: 'DROP_DOWN',
        code: 'mall',
        label: 'モール',
        options: {
          楽天: { label: '楽天', index: '0' },
          Amazon: { label: 'Amazon', index: '1' },
          自社サイト: { label: '自社サイト', index: '2' },
        },
      },
      product: { type: 'SINGLE_LINE_TEXT', code: 'product', label: '商品名' },
      rank: { type: 'NUMBER', code: 'rank', label: '順位', digit: false },
      out_of_rank: {
        type: 'CHECK_BOX',
        code: 'out_of_rank',
        label: 'ランキング外',
        options: { 圏外: { label: '圏外', index: '0' } },
        defaultValue: [],
      },
    },
  },
};

function numberField(code, label, { unit, unitPosition = 'AFTER', displayScale } = {}) {
  const f = { type: 'NUMBER', code, label, digit: true };
  if (unit) {
    f.unit = unit;
    f.unitPosition = unitPosition;
  }
  if (displayScale) f.displayScale = displayScale;
  return f;
}
