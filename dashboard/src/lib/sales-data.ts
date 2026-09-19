// 売上・利益（/sales）のデータ取得。計算は src/lib/metrics/sales-daily.ts と kpi-kintone.computeMonthlyOverview に委ねる。
// 売上: Kintone 毎朝KPI報告(30)（Kintone 直読み or 日次キャッシュ kpiDaily）。客単価: 売上明細(29) の取込（productSalesDaily・税込）。
// 粗利は原価率（仕入原価）が未入力のため「未取得」（推測しない）。
import { prisma } from './prisma';
import { computeMonthlyOverview, type KpiFetchResult, type MonthlyOverview } from './pro/kpi-kintone';
import { buildDailyTargets } from './metrics/daily-targets';
import { buildSalesDaily, channelShares, unitPrice, type ChannelShare, type SalesDailyRow } from './metrics/sales-daily';
import type { MetricValue } from './metrics/types';
import { getKpiRows, getMonthTargets, getWeights, type MonthTargetsDetail } from './targets-data';

export interface SalesMonth {
  month: string;
  kpi: KpiFetchResult;
  overview: MonthlyOverview | null;
  targets: MonthTargetsDetail;
  /** 重みが Setting に保存済みか（未保存なら全日 1.0 で等分） */
  weightsSaved: boolean;
  daily: SalesDailyRow[];
  channels: ChannelShare[];
  /** 売上明細ベースの客単価（税込売上 ÷ 販売個数）。明細が無い月は na */
  unitPrice: MetricValue;
  productUnits: number;
  productAmount: number;
  productDays: number;
  /** 粗利: 原価率未入力のため常に未取得（理由付き） */
  grossProfit: MetricValue;
}

export async function getSalesMonth(month: string): Promise<SalesMonth> {
  const [{ result, rows, prevRows }, targets, weights, products] = await Promise.all([
    getKpiRows(month),
    getMonthTargets(month),
    getWeights(month),
    prisma.productSalesDaily.groupBy({ by: ['date'], where: { date: { startsWith: month + '-' } }, _sum: { units: true, amount: true } }),
  ]);
  const overview = result.status === 'ok' ? computeMonthlyOverview(month, rows, prevRows, targets) : null;
  const dailyTargets = buildDailyTargets(month, targets.main, weights.weights);
  const productUnits = products.reduce((s, p) => s + (p._sum.units ?? 0), 0);
  const productAmount = products.reduce((s, p) => s + (p._sum.amount ?? 0), 0);
  return {
    month,
    kpi: result,
    overview,
    targets,
    weightsSaved: weights.exists,
    daily: buildSalesDaily(rows, dailyTargets),
    channels: channelShares(overview?.byChannel ?? { rakuten: 0, amazon: 0, own: 0 }),
    unitPrice: products.length ? unitPrice(productAmount, productUnits) : { kind: 'na', reason: '売上明細未取込' },
    productUnits,
    productAmount,
    productDays: products.length,
    grossProfit: { kind: 'na', reason: '未取得（原価率の入力待ち）' },
  };
}
