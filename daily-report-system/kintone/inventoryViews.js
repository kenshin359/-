// ============================================================
//  在庫管理アプリ  一覧とグラフの設定
// ------------------------------------------------------------
//  見たいのは主に3つです。
//    ・今日の在庫（Amazon と CS を分けて）
//    ・商品ごとに、どちらの倉庫にいくつあるか
//    ・在庫が減ってきている商品はどれか（日ごとの推移）
// ============================================================

const COLUMNS = [
  'snapshot_date',
  'staff',
  'total_amazon',
  'total_cs',
  'total_all',
  'f_stock_amazon',
  'f_stock_cs',
  'source',
];

export const VIEWS = {
  '今日': {
    type: 'LIST',
    name: '今日',
    index: '0',
    fields: COLUMNS,
    filterCond: 'snapshot_date = TODAY()',
    sort: 'snapshot_date desc',
  },
  '今週': {
    type: 'LIST',
    name: '今週',
    index: '1',
    fields: COLUMNS,
    filterCond: 'snapshot_date = THIS_WEEK()',
    sort: 'snapshot_date desc',
  },
  '今月': {
    type: 'LIST',
    name: '今月',
    index: '2',
    fields: COLUMNS,
    filterCond: 'snapshot_date = THIS_MONTH()',
    sort: 'snapshot_date desc',
  },
  'すべて': {
    type: 'LIST',
    name: 'すべて',
    index: '3',
    fields: [...COLUMNS, 'note'],
    sort: 'snapshot_date desc',
  },
};

export const REPORTS = {
  '今日の在庫（倉庫別）': {
    chartType: 'TABLE',
    name: '今日の在庫（倉庫別）',
    index: '0',
    groups: [],
    aggregations: [
      { type: 'SUM', code: 'i_amazon' },
      { type: 'SUM', code: 'i_cs' },
    ],
    filterCond: 'snapshot_date = TODAY()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今日の在庫（商品別）': {
    chartType: 'BAR',
    chartMode: 'STACKED',
    name: '今日の在庫（商品別）',
    index: '1',
    groups: [{ code: 'i_product' }],
    aggregations: [
      { type: 'SUM', code: 'i_amazon' },
      { type: 'SUM', code: 'i_cs' },
    ],
    filterCond: 'snapshot_date = TODAY()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '商品別の状態（今日）': {
    chartType: 'PIE',
    name: '商品別の状態（今日）',
    index: '2',
    groups: [{ code: 'i_status' }],
    aggregations: [{ type: 'COUNT' }],
    filterCond: 'snapshot_date = TODAY()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '在庫の推移（今月）': {
    chartType: 'LINE',
    chartMode: 'NORMAL',
    name: '在庫の推移（今月）',
    index: '3',
    groups: [{ code: 'snapshot_date', per: 'DAY' }],
    aggregations: [{ type: 'SUM', code: 'i_total' }],
    filterCond: 'snapshot_date = THIS_MONTH()',
    sorts: [{ by: 'GROUP1', order: 'ASC' }],
  },
  '商品別の在庫推移（今月）': {
    chartType: 'LINE',
    chartMode: 'NORMAL',
    name: '商品別の在庫推移（今月）',
    index: '4',
    groups: [{ code: 'snapshot_date', per: 'DAY' }, { code: 'i_product' }],
    aggregations: [{ type: 'SUM', code: 'i_total' }],
    filterCond: 'snapshot_date = THIS_MONTH()',
    sorts: [{ by: 'GROUP1', order: 'ASC' }],
  },
};
