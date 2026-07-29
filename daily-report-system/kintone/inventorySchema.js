// ============================================================
//  在庫数アプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = 1日 × 1商品 の在庫スナップショット。
//
//  なぜ「1日1商品1レコード」なのか:
//    ・日ごとの推移をグラフにできる
//    ・「いつ在庫が尽きたか」を後から遡って確認できる
//    ・Kintoneの絞り込み・集計がそのまま使える
//
//  倉庫は CS倉庫 と Amazon倉庫 を分けて持ちます。
//  Amazon の FBA 在庫は Amazon 倉庫にあり、楽天・自社の出荷には
//  使えないため、合算すると「あるはずなのに出せない」が起きるためです。
// ============================================================

export const APP_NAME = '在庫数';

export const FIELDS = {
  snapshot_date: {
    type: 'DATE', code: 'snapshot_date', label: '基準日', required: true,
    defaultNowValue: true,
  },
  product_name: {
    type: 'SINGLE_LINE_TEXT', code: 'product_name', label: '商品名', required: true,
  },
  sku: {
    type: 'SINGLE_LINE_TEXT', code: 'sku', label: 'SKU/商品管理番号', required: false,
  },
  product_group: {
    type: 'DROP_DOWN', code: 'product_group', label: 'カテゴリ', required: false,
    options: {
      'スーツケース': { label: 'スーツケース', index: '0' },
      'ファン': { label: 'ファン', index: '1' },
      '美容家電': { label: '美容家電', index: '2' },
      'トラベル用品': { label: 'トラベル用品', index: '3' },
      'その他家電': { label: 'その他家電', index: '4' },
      'その他': { label: 'その他', index: '5' },
    },
  },

  // ── 倉庫別の在庫数 ──
  stock_cs: {
    type: 'NUMBER', code: 'stock_cs', label: 'CS倉庫 在庫数', required: false,
    unit: '個', unitPosition: 'AFTER', digit: true,
  },
  stock_amazon: {
    type: 'NUMBER', code: 'stock_amazon', label: 'Amazon倉庫 在庫数', required: false,
    unit: '個', unitPosition: 'AFTER', digit: true,
  },
  stock_total: {
    type: 'CALC', code: 'stock_total', label: '合計在庫数', required: false,
    expression: 'stock_cs + stock_amazon',
    format: 'NUMBER_DIGIT', unit: '個', unitPosition: 'AFTER',
  },

  // ── 入荷予定（欠品の見通しを立てるため）──
  incoming_qty: {
    type: 'NUMBER', code: 'incoming_qty', label: '入荷予定数', required: false,
    unit: '個', unitPosition: 'AFTER', digit: true,
  },
  incoming_date: {
    type: 'DATE', code: 'incoming_date', label: '入荷予定日', required: false,
  },

  // ── 状態 ──
  status: {
    type: 'DROP_DOWN', code: 'status', label: '在庫状態', required: false,
    options: {
      '在庫あり': { label: '在庫あり', index: '0' },
      '残りわずか': { label: '残りわずか', index: '1' },
      '欠品': { label: '欠品', index: '2' },
      '販売停止': { label: '販売停止', index: '3' },
    },
  },
  note: {
    type: 'MULTI_LINE_TEXT', code: 'note', label: '備考', required: false,
  },

  // 同じ日に同じ商品を二重登録しないための鍵。
  // 例: 2026-07-29__スーツケースS
  // ★unique にすることで、取り込みを二度流しても増えない。
  dedup_key: {
    type: 'SINGLE_LINE_TEXT', code: 'dedup_key', label: '重複防止キー',
    required: false, unique: true,
  },
};

/** 重複防止キーを組み立てる */
export function dedupKey(dateISO, productName) {
  return `${dateISO}__${productName}`;
}
