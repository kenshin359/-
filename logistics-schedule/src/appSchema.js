// 「物流スケジュール」アプリのフィールド定義。
// 設計思想：1レコード＝1コンテナ（1船積み）。
//   パッキングリスト（出荷）→ BL 発行 → アライバル（入港）→ 通関 → ドレー搬入
//   → 入庫 → 発送可能、という物流の流れを 1 レコードで最初から最後まで追える。
// コンテナ番号を実質キーとして扱い（unique）、同じコンテナは 1 行に集約する。

export const FIELDS = {
  // ── 進捗ステータス（カンバン／絞り込み用）──
  status: {
    type: 'DROP_DOWN',
    code: 'status',
    label: 'ステータス',
    defaultValue: '出荷済',
    options: {
      計画: { label: '計画', index: '0' }, // 発注済・出荷前（コンテナ未割当）
      出荷済: { label: '出荷済', index: '1' },
      船積済: { label: '船積済', index: '2' },
      入港済: { label: '入港済', index: '3' },
      通関済: { label: '通関済', index: '4' },
      ドレー手配済: { label: 'ドレー手配済', index: '5' },
      入庫済: { label: '入庫済', index: '6' },
      発送可能: { label: '発送可能', index: '7' },
    },
  },

  // ── パッキングリスト（出荷情報）──
  shipping_date: {
    // パッキングリストの「日期」＝出荷日。一覧の起点になる必須項目。
    type: 'DATE',
    code: 'shipping_date',
    label: '出荷日',
    required: false, // 「計画」段階（未出荷）は空を許容。出荷後に確定
    defaultNowValue: false,
  },
  container_no: {
    // 货柜号。1コンテナ＝1レコードのキー。
    type: 'SINGLE_LINE_TEXT',
    code: 'container_no',
    label: 'コンテナ番号',
    required: true,
    unique: true,
  },
  seal_no: text('seal_no', 'シール番号'),
  po_number: text('po_number', 'PO番号'),
  container_type: {
    type: 'DROP_DOWN',
    code: 'container_type',
    label: 'コンテナタイプ',
    options: {
      '20GP': { label: '20GP', index: '0' },
      '40GP': { label: '40GP', index: '1' },
      '40HQ': { label: '40HQ', index: '2' },
      '45HQ': { label: '45HQ', index: '3' },
    },
  },

  // ── 数量サマリー（パッキングリストの合計を集計）──
  total_cartons: numberField('total_cartons', '総カートン数', { unit: 'CTN' }),
  total_qty: numberField('total_qty', '総数量', { unit: '個' }),
  gross_weight: numberField('gross_weight', '総重量', { unit: 'KG', displayScale: '2' }),
  total_volume: numberField('total_volume', '総体積', { unit: 'CBM', displayScale: '3' }),

  // ── BL 情報 ──
  hbl_no: text('hbl_no', 'H B/L番号'),
  mbl_no: text('mbl_no', 'M B/L番号'),
  bl_surrendered: {
    type: 'DROP_DOWN',
    code: 'bl_surrendered',
    label: 'B/Lサレンダー',
    options: {
      未: { label: '未', index: '0' },
      済: { label: '済', index: '1' },
    },
  },
  vessel: text('vessel', '本船／航海番号'),
  pol: text('pol', '船積港 (POL)'),
  pod: text('pod', '荷揚港 (POD)'),

  // ── スケジュール（この 4 つが日々更新していく管理項目）──
  arrival_date: dateField('arrival_date', 'アライバル（入港予定日）'),
  customs_date: dateField('customs_date', '通関予定日'),
  dray_status: {
    type: 'DROP_DOWN',
    code: 'dray_status',
    label: 'ドレー手配状況',
    defaultValue: '未手配',
    options: {
      未手配: { label: '未手配', index: '0' },
      手配中: { label: '手配中', index: '1' },
      手配完了: { label: '手配完了', index: '2' },
      搬入済: { label: '搬入済', index: '3' },
    },
  },
  dray_date: dateField('dray_date', 'ドレー搬入日'),
  warehousing_date: dateField('warehousing_date', '入庫日'),
  shippable_date: dateField('shippable_date', '発送可能日'),

  // ── 監査・チェック ──
  auditor: text('auditor', '監査役'), // 確認担当（1名）
  check_status: {
    type: 'CHECK_BOX',
    code: 'check_status',
    label: 'チェック',
    options: {
      確認済: { label: '確認済', index: '0' },
      数量突合済: { label: '数量突合済', index: '1' },
      書類完備: { label: '書類完備', index: '2' },
    },
  },
  audit_date: dateField('audit_date', '監査日'),

  // ── その他 ──
  ref_no: text('ref_no', 'REF番号'),
  cargo_control_no: text('cargo_control_no', '貨物管理番号'),
  remarks: {
    type: 'MULTI_LINE_TEXT',
    code: 'remarks',
    label: '備考',
  },

  // ── 明細（パッキングリストの品目テーブル）──
  items: {
    type: 'SUBTABLE',
    code: 'items',
    label: '品目明細',
    fields: {
      item_name: text('item_name', '品名'),
      item_color: text('item_color', '色'),
      item_spec: text('item_spec', '規格'),
      carton_size: text('carton_size', '外箱サイズ'),
      item_gw: numberField('item_gw', '毛重', { unit: 'KG', displayScale: '2' }),
      item_nw: numberField('item_nw', '純重', { unit: 'KG', displayScale: '2' }),
      item_qty: numberField('item_qty', '数量', { unit: '個' }),
      item_volume: numberField('item_volume', '総体積', { unit: 'CBM', displayScale: '3' }),
    },
  },
};

// 一覧ビューに表示する列（ユーザー要望の並び順）。createApp が設定する。
export const LIST_FIELDS = [
  'shipping_date', // パッキングリスト＝出荷日
  'container_no',
  'po_number',
  'hbl_no',
  'arrival_date', // アライバル
  'customs_date', // 通関予定日
  'dray_status', // ドレー手配状況
  'warehousing_date', // 入庫日
  'shippable_date', // 発送可能日
  'status',
  'check_status', // チェック
  'auditor', // 監査役
];

function text(code, label) {
  return { type: 'SINGLE_LINE_TEXT', code, label };
}

function dateField(code, label) {
  return { type: 'DATE', code, label, defaultNowValue: false };
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
