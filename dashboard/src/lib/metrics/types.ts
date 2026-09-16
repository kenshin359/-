// 指標計算の入力型（DB行のサブセット）。docs/metrics.md が正。
// 金額はすべて税抜・円・整数。

export interface OrderRow {
  orderId: string;
  channelCode: string;
  /** JST暦日 YYYY-MM-DD（出荷日基準。未出荷は注文日） */
  date: string;
  status: 'ordered' | 'shipped' | 'cancelled';
  shippingRevenue: number;
  discount: number;
}

export interface OrderItemRow {
  orderId: string;
  skuCode: string;
  qty: number;
  unitPrice: number;
  /** 取引時点原価。未登録は null（暫定扱い） */
  costAtSale: number | null;
}

export interface RefundRow {
  orderId: string;
  /** 返金処理日 YYYY-MM-DD */
  date: string;
  amount: number;
}

export interface AdRow {
  date: string;
  mediaCode: string;
  campaign: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  mediaCv: number | null;
  /** 媒体報告の帰属売上。未取得は null（総売上で代用しない） */
  attributedRevenue: number | null;
}

export interface AccessRow {
  date: string;
  channelCode: string;
  sessions: number;
}

export interface CostRow {
  date: string;
  costType: 'commission' | 'shipping' | 'other_variable';
  amount: number;
  scope: string;
  scopeCode: string;
}

/** 数値または「出せない理由」。NaN/Infinity を画面に出さないための表現 */
export type MetricValue =
  | { kind: 'value'; value: number }
  | { kind: 'na'; reason: string };

export interface PeriodMetrics {
  netSales: number;
  itemRevenue: number;
  shippingRevenue: number;
  discount: number;
  refunds: number;
  cogs: number;
  /** 原価未登録の明細行数（>0 なら「暫定」表示） */
  cogsMissingLines: number;
  grossProfit: number;
  adSpend: number;
  commission: number;
  shippingCost: number;
  otherVariable: number;
  contributionProfit: number;
  contributionMargin: MetricValue; // %
  orderCount: number;
  unitCount: number;
  aov: MetricValue; // 客単価
  sessions: number | null; // null = access_daily 未取得
  cvr: MetricValue; // %
  attributedRevenue: number | null; // null = 未取得媒体あり（合算不能）
  roas: MetricValue;
  mer: MetricValue;
  adRatio: MetricValue; // %
}
