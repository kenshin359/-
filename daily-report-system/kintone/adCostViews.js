// ============================================================
//  広告費管理アプリ  一覧とグラフの設定
// ------------------------------------------------------------
//  社長のご要望「入力画面で 今月・昨日の総広告費、商品ごとの広告費」を
//  kintone の標準機能（一覧・グラフ）で出します。
//
//  一覧 … 昨日 / 今月 / 先月 / すべて
//  グラフ … 今月の総額、今月の商品別、今月の媒体別、日ごとの推移
//
//  ★kintone の絞り込みでは YESTERDAY() や THIS_MONTH() が使えるので、
//    日付を毎月書き換える必要はありません。
// ============================================================

/** 一覧（レコードの表） */
export const VIEWS = {
  '昨日': {
    type: 'LIST',
    name: '昨日',
    index: '0',
    fields: ['report_date', 'total_cost', 'total_clicks', 'total_conversions', 'source', 'note'],
    filterCond: 'report_date = YESTERDAY()',
    sort: 'report_date desc',
  },
  '今月': {
    type: 'LIST',
    name: '今月',
    index: '1',
    fields: ['report_date', 'total_cost', 'total_clicks', 'total_conversions', 'source', 'note'],
    filterCond: 'report_date = THIS_MONTH()',
    sort: 'report_date desc',
  },
  '先月': {
    type: 'LIST',
    name: '先月',
    index: '2',
    fields: ['report_date', 'total_cost', 'total_clicks', 'total_conversions', 'source', 'note'],
    filterCond: 'report_date = LAST_MONTH()',
    sort: 'report_date desc',
  },
  'すべて': {
    type: 'LIST',
    name: 'すべて',
    index: '3',
    fields: ['report_date', 'total_cost', 'total_clicks', 'total_conversions', 'source', 'note'],
    sort: 'report_date desc',
  },
};

/**
 * グラフ（集計）。
 * groups が「分類項目」、aggregations が「集計方法」です。
 * 明細テーブルの中の項目（d_product / d_media）でも分類できます。
 */
export const REPORTS = {
  '今月の総広告費': {
    chartType: 'TABLE',
    name: '今月の総広告費',
    index: '0',
    groups: [],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '昨日の総広告費': {
    chartType: 'TABLE',
    name: '昨日の総広告費',
    index: '1',
    groups: [],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = YESTERDAY()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月 商品別の広告費': {
    chartType: 'BAR',
    chartMode: 'NORMAL',
    name: '今月 商品別の広告費',
    index: '2',
    groups: [{ code: 'd_product' }],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月 媒体別の広告費': {
    chartType: 'PIE',
    name: '今月 媒体別の広告費',
    index: '3',
    groups: [{ code: 'd_media' }],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月 ブランド別の広告費': {
    chartType: 'PIE',
    name: '今月 ブランド別の広告費',
    index: '8',
    groups: [{ code: 'd_brand' }],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月 ブランド × 媒体': {
    chartType: 'COLUMN',
    chartMode: 'STACKED',
    name: '今月 ブランド × 媒体',
    index: '9',
    groups: [{ code: 'd_brand' }, { code: 'd_media' }],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月 媒体 × 商品': {
    chartType: 'COLUMN',
    chartMode: 'STACKED',
    name: '今月 媒体 × 商品',
    index: '4',
    groups: [{ code: 'd_product' }, { code: 'd_media' }],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '日ごとの広告費（今月）': {
    chartType: 'COLUMN',
    chartMode: 'NORMAL',
    name: '日ごとの広告費（今月）',
    index: '5',
    groups: [{ code: 'report_date', per: 'DAY' }],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'GROUP1', order: 'ASC' }],
  },
  '月ごとの広告費': {
    chartType: 'COLUMN',
    chartMode: 'NORMAL',
    name: '月ごとの広告費',
    index: '6',
    groups: [{ code: 'report_date', per: 'MONTH' }],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    sorts: [{ by: 'GROUP1', order: 'ASC' }],
  },
  '今月 販売先別の広告費': {
    chartType: 'PIE',
    name: '今月 販売先別の広告費',
    index: '7',
    groups: [{ code: 'd_channel' }],
    aggregations: [{ type: 'SUM', code: 'd_cost' }],
    filterCond: 'report_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
};
