// 「在庫」アプリのフィールド定義。
// 設計思想：1レコード＝1SKU（商品ID＝ライン×サイズ×色）。
//   倉庫の現在庫を持ち、物流スケジュール（入荷予定）と合わせて
//   「在庫ニュース」を自動生成する土台。
//   商品ID をユニークキーに upsert（同じSKUは1レコードへ集約）。

export const FIELDS = {
  product_id: {
    type: 'SINGLE_LINE_TEXT',
    code: 'product_id',
    label: '商品ID',
    required: true,
    unique: true,
  },
  line: {
    type: 'DROP_DOWN',
    code: 'line',
    label: 'ライン',
    options: dd(['多機能PC', '多機能アルミ', 'ノーマルアルミ', 'ジップ', 'ハンディファン', 'その他']),
  },
  size: {
    type: 'DROP_DOWN',
    code: 'size',
    label: 'サイズ',
    options: dd(['S', 'M', 'L', '-']),
  },
  color: text('color', '色'),
  finish: {
    type: 'DROP_DOWN',
    code: 'finish',
    label: '仕上げ',
    options: dd(['マット', 'エナメル', '-']),
  },

  // ── 在庫数 ──
  stock_amazon: numberField('stock_amazon', 'Amazon分', { unit: '個' }),
  stock_good: numberField('stock_good', '良品在庫', { unit: '個' }),
  stock_total: {
    // 在庫合計＝Amazon分＋良品（自動計算）
    type: 'CALC',
    code: 'stock_total',
    label: '在庫合計',
    expression: 'stock_amazon + stock_good',
    format: 'NUMBER',
    unit: '個',
    unitPosition: 'AFTER',
  },
  allocated: numberField('allocated', '引当数', { unit: '個' }),

  // ── 販売・補充管理 ──
  daily_sales: numberField('daily_sales', '日販', { unit: '個/日', displayScale: '1' }),
  reorder_point: numberField('reorder_point', '発注点', { unit: '個' }),
  stock_status: {
    type: 'DROP_DOWN',
    code: 'stock_status',
    label: '在庫ステータス',
    defaultValue: '適正',
    options: {
      欠品: { label: '欠品', index: '0' },
      僅少: { label: '僅少', index: '1' },
      適正: { label: '適正', index: '2' },
      過剰: { label: '過剰', index: '3' },
    },
  },

  snapshot_date: { type: 'DATE', code: 'snapshot_date', label: '在庫日', defaultNowValue: false },
  remarks: { type: 'MULTI_LINE_TEXT', code: 'remarks', label: '備考' },
};

// 一覧ビューに表示する列
export const LIST_FIELDS = [
  'product_id',
  'line',
  'size',
  'color',
  'stock_amazon',
  'stock_good',
  'stock_total',
  'daily_sales',
  'stock_status',
  'snapshot_date',
];

function text(code, label) {
  return { type: 'SINGLE_LINE_TEXT', code, label };
}
function numberField(code, label, { unit, unitPosition = 'AFTER', displayScale } = {}) {
  const f = { type: 'NUMBER', code, label, digit: true };
  if (unit) {
    f.unit = unit;
    f.unitPosition = unitPosition;
  }
  if (displayScale) f.displayScale = displayScale;
  return f;
}
function dd(labels) {
  const o = {};
  labels.forEach((l, i) => (o[l] = { label: l, index: String(i) }));
  return o;
}
