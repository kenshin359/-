// ============================================================
//  在庫報告（CS出荷後）アプリ  フィールド定義
// ------------------------------------------------------------
//  CSチームが毎日の出荷作業が終わったあとに、
//  「商品ごとの残り在庫数」を入力するアプリ。
//
//  ・1レコード = 1日分の報告
//  ・商品名はドロップダウン（売上明細アプリと同じ表記に統一
//    → 販売数と突き合わせて消化率を自動計算できる）
//  ・カラー/SKUは自由記入（例: ホワイト、CFA-C）
//  ・在庫表のスクショやCSVがあれば添付欄へ
// ============================================================

export const APP_NAME = '在庫報告（CS出荷後）';

const drop = (code, label, options, defaultValue) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
  ...(defaultValue ? { defaultValue } : {}),
});

// 売上明細（自動取込）の商品名と同じ表記にそろえる（突き合わせ用）
export const PRODUCT_OPTIONS = [
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
  'その他',
];

export const FIELDS = {
  report_date: {
    type: 'DATE',
    code: 'report_date',
    label: '報告日（出荷作業をした日）',
    required: true,
    defaultNowValue: true,
  },
  staff: drop('staff', '記入者', ['笹本', '村田', '関本', 'その他'], undefined),

  stock_rows: {
    type: 'SUBTABLE',
    code: 'stock_rows',
    label: '残り在庫（商品ごとに1行）',
    fields: {
      st_product: drop('st_product', '商品', PRODUCT_OPTIONS, undefined),
      st_sku: {
        type: 'SINGLE_LINE_TEXT',
        code: 'st_sku',
        label: 'カラー/SKU（任意。例: ホワイト）',
      },
      st_qty: {
        type: 'NUMBER',
        code: 'st_qty',
        label: '残り在庫数',
        required: true,
      },
      st_memo: {
        type: 'SINGLE_LINE_TEXT',
        code: 'st_memo',
        label: 'メモ（任意。例: 倉庫Bぶん含む）',
      },
    },
  },

  file_stock: {
    type: 'FILE',
    code: 'file_stock',
    label: '📎 在庫表のスクショ・CSV（あれば）',
  },
  memo: { type: 'MULTI_LINE_TEXT', code: 'memo', label: '備考（欠品・入荷予定など）' },
};

export const VIEWS = {
  '今日の報告': {
    index: 0,
    type: 'LIST',
    name: '今日の報告',
    fields: ['report_date', 'staff', 'memo'],
    filterCond: 'report_date = TODAY()',
    sort: 'report_date desc',
  },
  すべて: {
    index: 1,
    type: 'LIST',
    name: 'すべて',
    fields: ['report_date', 'staff', 'memo'],
    sort: 'report_date desc',
  },
};
