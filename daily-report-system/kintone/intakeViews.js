// ============================================================
//  日次CSV提出ボックス  一覧の設定
// ------------------------------------------------------------
//  毎朝の作業と、あとから元ファイルを探す作業の両方をしやすくします。
//
//  ★グラフ（集計）は作りません。
//    このアプリで見たいのは「今日そろっているか」だけで、
//    合計や平均に意味がないためです。
// ============================================================

const FILE_COLUMNS = [
  'report_date',
  'staff',
  'f_sales_amazon',
  'f_sales_rakuten',
  'f_sales_shopify',
  'f_sales_tiktok',
  'f_ad_meta',
  'f_ad_rpp',
  'f_ad_google',
  'f_ad_other',
  'status',
];

export const VIEWS = {
  '今日': {
    type: 'LIST',
    name: '今日',
    index: '0',
    fields: FILE_COLUMNS,
    filterCond: 'report_date = TODAY()',
    sort: 'report_date desc',
  },
  '今週': {
    type: 'LIST',
    name: '今週',
    index: '1',
    fields: FILE_COLUMNS,
    filterCond: 'report_date = THIS_WEEK()',
    sort: 'report_date desc',
  },
  '未取込': {
    type: 'LIST',
    name: '未取込',
    index: '2',
    fields: [...FILE_COLUMNS, 'import_log'],
    filterCond: 'status not in ("取込済み", "対象外(休業日)")',
    sort: 'report_date desc',
  },
  'すべて': {
    type: 'LIST',
    name: 'すべて',
    index: '3',
    fields: [...FILE_COLUMNS, 'import_log', 'note'],
    sort: 'report_date desc',
  },
};
