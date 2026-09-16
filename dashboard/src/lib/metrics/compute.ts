// 全画面共通の集計関数。画面ごとの独自計算を禁止（docs/metrics.md）。
import type {
  AccessRow,
  AdRow,
  CostRow,
  MetricValue,
  OrderItemRow,
  OrderRow,
  PeriodMetrics,
  RefundRow,
} from './types';

const value = (v: number): MetricValue => ({ kind: 'value', value: v });
const na = (reason: string): MetricValue => ({ kind: 'na', reason });

/** 分母0・データ欠損でNaN/Infinityを作らない安全除算 */
export function safeDiv(
  numer: number,
  denom: number,
  zeroReason: string,
): MetricValue {
  if (denom === 0) return na(zeroReason);
  return value(numer / denom);
}

export interface ComputeInput {
  orders: OrderRow[];
  items: OrderItemRow[];
  refunds: RefundRow[];
  ads: AdRow[];
  access: AccessRow[] | null; // null = アクセスデータ自体が未取得
  costs: CostRow[];
}

/**
 * 期間・スコープ絞り込み済みの行から指標一式を計算する。
 * キャンセル注文はここで除外する（呼び出し側の除外漏れを防ぐ）。
 */
export function computePeriodMetrics(input: ComputeInput): PeriodMetrics {
  const activeOrders = input.orders.filter((o) => o.status !== 'cancelled');
  const activeIds = new Set(activeOrders.map((o) => o.orderId));
  const items = input.items.filter((i) => activeIds.has(i.orderId));

  const itemRevenue = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const shippingRevenue = activeOrders.reduce((s, o) => s + o.shippingRevenue, 0);
  const discount = activeOrders.reduce((s, o) => s + o.discount, 0);
  const refunds = input.refunds.reduce((s, r) => s + r.amount, 0);
  const netSales = itemRevenue + shippingRevenue - discount - refunds;

  let cogs = 0;
  let cogsMissingLines = 0;
  for (const i of items) {
    if (i.costAtSale === null) cogsMissingLines += 1;
    else cogs += i.qty * i.costAtSale;
  }
  const grossProfit = netSales - cogs;

  const adSpend = input.ads.reduce((s, a) => s + a.spend, 0);
  const commission = sumCost(input.costs, 'commission');
  const shippingCost = sumCost(input.costs, 'shipping');
  const otherVariable = sumCost(input.costs, 'other_variable');
  const contributionProfit =
    netSales - cogs - adSpend - commission - shippingCost - otherVariable;

  const orderCount = activeIds.size;
  const unitCount = items.reduce((s, i) => s + i.qty, 0);

  const sessions =
    input.access === null
      ? null
      : input.access.reduce((s, a) => s + a.sessions, 0);

  // 帰属売上: 1媒体でも未取得(null)があれば合算値を出さない（過小表示を防ぐ）
  let attributedRevenue: number | null = 0;
  for (const a of input.ads) {
    if (a.attributedRevenue === null) {
      attributedRevenue = null;
      break;
    }
    attributedRevenue += a.attributedRevenue;
  }
  if (input.ads.length === 0) attributedRevenue = null;

  return {
    netSales,
    itemRevenue,
    shippingRevenue,
    discount,
    refunds,
    cogs,
    cogsMissingLines,
    grossProfit,
    adSpend,
    commission,
    shippingCost,
    otherVariable,
    contributionProfit,
    contributionMargin: safeDiv(contributionProfit * 100, netSales, '純売上0'),
    orderCount,
    unitCount,
    aov: safeDiv(netSales, orderCount, '注文0'),
    sessions,
    cvr:
      sessions === null
        ? na('セッション未取得')
        : safeDiv(orderCount * 100, sessions, 'セッション0'),
    attributedRevenue,
    roas:
      attributedRevenue === null
        ? na('帰属売上未取得')
        : safeDiv(attributedRevenue, adSpend, '広告費0'),
    mer: safeDiv(netSales, adSpend, '広告費0'),
    adRatio: safeDiv(adSpend * 100, netSales, '純売上0'),
  };
}

function sumCost(costs: CostRow[], type: CostRow['costType']): number {
  return costs.filter((c) => c.costType === type).reduce((s, c) => s + c.amount, 0);
}

/**
 * 着地予測 = 確定済み日次売上平均 × 当月日数（docs/metrics.md）。
 * 未取込日を0として平均に入れない。確定3日未満は予測不可。
 */
export function forecastMonthEnd(
  dailyNetSales: Map<string, number>, // 確定日のみ（YYYY-MM-DD → 円）
  daysInMonth: number,
): MetricValue {
  const days = dailyNetSales.size;
  if (days < 3) return na('予測不可(データ不足)');
  let total = 0;
  for (const v of dailyNetSales.values()) total += v;
  return value(Math.round((total / days) * daysInMonth));
}

/** 前期間比。前期間0は「比較不可」 */
export function changeRate(current: number, previous: number): MetricValue {
  if (previous === 0) return na('比較不可(前期間0)');
  return value(((current - previous) / previous) * 100);
}
