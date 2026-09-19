// 広告分析（/ads）・日別売上CSV のデータ取得。計算は src/lib/metrics/ad-daily.ts に委ねる。
// 元データは KpiDaily（Kintone 毎朝KPI報告(30) の日次取込。取込専用テーブルで demo データは存在しない）。
// 判定閾値は合算CPAと同じ Setting（cpa.targetRatio / cpa.limitRatio。既定 15% / 20%）を使う。
import { prisma } from './prisma';
import { getCpaThresholds } from './cpa-data';
import { computeAdMonth, type AdDailyRow } from './metrics/ad-daily';
import type { DailySalesCsvRow } from './metrics/daily-sales-csv';

export async function getKpiDailyRows(month: string): Promise<DailySalesCsvRow[]> {
  const list = await prisma.kpiDaily.findMany({ where: { date: { startsWith: month + '-' } }, orderBy: { date: 'asc' } });
  return list.map((r) => ({
    date: r.date,
    salesRakuten: r.salesRakuten,
    salesAmazon: r.salesAmazon,
    salesOwn: r.salesOwn,
    target: r.target,
    adGoogle: r.adGoogle,
    adRakuten: r.adRakuten,
    adAmazon: r.adAmazon,
    adMeta: r.adMeta,
  }));
}

export async function getAdMonth(month: string) {
  const [thresholds, list] = await Promise.all([
    getCpaThresholds(),
    prisma.kpiDaily.findMany({ where: { date: { startsWith: month + '-' } }, orderBy: { date: 'asc' } }),
  ]);
  const rows: AdDailyRow[] = list.map((r) => ({
    date: r.date,
    salesTotal: r.salesRakuten + r.salesAmazon + r.salesOwn,
    ad: { google: r.adGoogle, rakuten: r.adRakuten, amazon: r.adAmazon, meta: r.adMeta },
  }));
  const lastUpdated = list.reduce<Date | null>((a, r) => (!a || r.updatedAt > a ? r.updatedAt : a), null);
  return { thresholds, result: computeAdMonth(rows, thresholds), lastUpdated };
}

/** KpiDaily にデータがある月（新しい順）。当月は無くても先頭に含める */
export async function getKpiDailyMonths(thisMonth: string): Promise<string[]> {
  const rows = await prisma.kpiDaily.findMany({ select: { date: true } });
  const set = new Set<string>([thisMonth, ...rows.map((r) => r.date.slice(0, 7))]);
  return [...set].sort().reverse();
}
