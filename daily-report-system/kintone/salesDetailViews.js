// ============================================================
//  売上明細（自動取込）アプリ  一覧とグラフ
// ------------------------------------------------------------
//  見たいのは主に3つ。
//    ・今日／今月の売上が、どの商品でいくらか
//    ・販売先ごとの内訳（Amazon と 楽天 を並べて見る）
//    ・紐づけが「要確認」のまま残っている売上はいくらか
// ============================================================

const COLUMNS = ['report_date', 'total_amount', 'total_qty', 'source', 'note'];

export const VIEWS = {
  '今日': {
    type: 'LIST', name: '今日', index: '0',
    fields: COLUMNS,
    filterCond: 'report_date = TODAY()',
    sort: 'report_date desc',
  },
  '今週': {
    type: 'LIST', name: '今週', index: '1',
    fields: COLUMNS,
    filterCond: 'report_date = THIS_WEEK()',
    sort: 'report_date desc',
  },
  '今月': {
    type: 'LIST', name: '今月', index: '2',
    fields: COLUMNS,
    filterCond: 'report_date = THIS_MONTH()',
    sort: 'report_date desc',
  },
  'すべて': {
    type: 'LIST', name: 'すべて', index: '3',
    fields: [...COLUMNS, 'import_log'],
    sort: 'report_date desc',
  },
};

export const REPORTS = {
  '今月の売上（販売先別）': {
    chartType: 'PIE',
    name: '今月の売上（販売先別）',
    index: '0',
    groups: [{ code: 's_channel' }],
    aggregations: [{ type: 'SUM', code: 's_amount' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月の売上（商品別）': {
    chartType: 'BAR',
    chartMode: 'STACKED',
    name: '今月の売上（商品別）',
    index: '1',
    groups: [{ code: 's_product' }, { code: 's_channel' }],
    aggregations: [{ type: 'SUM', code: 's_amount' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月の販売個数（商品別）': {
    chartType: 'BAR',
    chartMode: 'STACKED',
    name: '今月の販売個数（商品別）',
    index: '2',
    groups: [{ code: 's_product' }, { code: 's_channel' }],
    aggregations: [{ type: 'SUM', code: 's_qty' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '日ごとの売上（今月）': {
    chartType: 'COLUMN',
    chartMode: 'STACKED',
    name: '日ごとの売上（今月）',
    index: '3',
    groups: [{ code: 'report_date', per: 'DAY' }, { code: 's_channel' }],
    aggregations: [{ type: 'SUM', code: 's_amount' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'GROUP1', order: 'ASC' }],
  },
  // ★紐づけが未確定のまま残っている売上を可視化する。
  //   放置すると「未分類」が積み上がり、商品別の数字が信用できなくなる。
  '紐づけ要確認（今月）': {
    chartType: 'TABLE',
    name: '紐づけ要確認（今月）',
    index: '4',
    groups: [{ code: 's_confidence' }, { code: 's_title' }],
    aggregations: [{ type: 'SUM', code: 's_amount' }],
    filterCond: 'report_date = THIS_MONTH() and s_confidence in ("要確認")',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
};
