// 「発注管理」アプリのフィールド定義。
// 設計思想：1レコード＝1発注（PO番号）。発注→生産→出荷→入荷の起点。
//   発注番号を物流スケジュール（コンテナ）の「発注番号」と紐付けて、
//   発注情報 → コンテナ → 書類 → 在庫 を一気にたどれる。

export const FIELDS = {
  order_no: {
    type: 'SINGLE_LINE_TEXT',
    code: 'order_no',
    label: '発注番号',
    required: true,
    unique: true,
  },
  order_date: { type: 'DATE', code: 'order_date', label: '発注日', defaultNowValue: false },
  supplier: text('supplier', '仕入先'),
  line: {
    type: 'DROP_DOWN',
    code: 'line',
    label: '主要ライン',
    options: dd(['多機能PC', '多機能アルミ', 'ノーマルアルミ', 'ジップ', 'ハンディファン', '混載', 'その他']),
  },
  status: {
    type: 'DROP_DOWN',
    code: 'status',
    label: '発注ステータス',
    defaultValue: '発注済',
    options: dd(['発注済', '生産中', '出荷済', '一部入荷', '入荷完了', 'キャンセル']),
  },
  ship_plan: text('ship_plan', '出荷/納期計画'),
  total_qty: numberField('total_qty', '総数量', { unit: '個' }),
  related_containers: text('related_containers', '関連コンテナ番号'),

  // ── 書類 ──
  file_order: { type: 'FILE', code: 'file_order', label: '発注書/依頼書' },
  file_pi: { type: 'FILE', code: 'file_pi', label: 'PI/インボイス' },
  file_other: { type: 'FILE', code: 'file_other', label: 'その他書類' },

  remarks: { type: 'MULTI_LINE_TEXT', code: 'remarks', label: '備考' },

  // ── 明細（サイズ×仕上げ×色×数量）──
  items: {
    type: 'SUBTABLE',
    code: 'items',
    label: '発注明細',
    fields: {
      it_size: { type: 'DROP_DOWN', code: 'it_size', label: 'サイズ', options: dd(['S', 'M', 'L', '-']) },
      it_finish: { type: 'DROP_DOWN', code: 'it_finish', label: '仕上げ', options: dd(['マット', 'エナメル', '-']) },
      it_color: text('it_color', 'カラー'),
      it_qty: numberField('it_qty', '数量', { unit: '個' }),
    },
  },
};

export const LIST_FIELDS = [
  'order_no',
  'order_date',
  'line',
  'status',
  'ship_plan',
  'total_qty',
  'related_containers',
];

function text(code, label) {
  return { type: 'SINGLE_LINE_TEXT', code, label };
}
function numberField(code, label, { unit, unitPosition = 'AFTER' } = {}) {
  const f = { type: 'NUMBER', code, label, digit: true };
  if (unit) {
    f.unit = unit;
    f.unitPosition = unitPosition;
  }
  return f;
}
function dd(labels) {
  const o = {};
  labels.forEach((l, i) => (o[l] = { label: l, index: String(i) }));
  return o;
}
