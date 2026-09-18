// 合算CPA画面のデータ取得。計算は src/lib/metrics/cpa.ts に委ねる。
import { prisma } from './prisma';
import { computeCpaMonth, DEFAULT_CPA_THRESHOLDS, type CpaDailyRow, type CpaThresholds } from './metrics/cpa';

export const CPA_SETTING_KEYS = {
  aov: 'cpa.aov',
  targetRatio: 'cpa.targetRatio',
  limitRatio: 'cpa.limitRatio',
} as const;

export async function getCpaThresholds(): Promise<CpaThresholds> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(CPA_SETTING_KEYS) } } });
  const map = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const pick = (key: string, def: number) => {
    const v = map.get(key);
    return v != null && Number.isFinite(v) && v > 0 ? v : def;
  };
  return {
    aov: pick(CPA_SETTING_KEYS.aov, DEFAULT_CPA_THRESHOLDS.aov),
    targetRatio: pick(CPA_SETTING_KEYS.targetRatio, DEFAULT_CPA_THRESHOLDS.targetRatio),
    limitRatio: pick(CPA_SETTING_KEYS.limitRatio, DEFAULT_CPA_THRESHOLDS.limitRatio),
  };
}

export async function getCpaMonthRows(month: string): Promise<CpaDailyRow[]> {
  const rows = await prisma.cpaDaily.findMany({
    where: { date: { startsWith: month + '-' } },
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => ({
    date: r.date,
    suitcaseSales: r.suitcaseSales,
    meta: r.meta,
    amazonAds: r.amazonAds,
    rpp: r.rpp,
    google: r.google,
    other: r.other,
    unitsAmazon: r.unitsAmazon,
    unitsRakuten: r.unitsRakuten,
    unitsOwn: r.unitsOwn,
  }));
}

export async function getCpaMonth(month: string) {
  const [thresholds, rows, meta] = await Promise.all([
    getCpaThresholds(),
    getCpaMonthRows(month),
    prisma.cpaDaily.findMany({
      where: { date: { startsWith: month + '-' } },
      select: { date: true, note: true, updatedBy: true, updatedAt: true },
    }),
  ]);
  const notes = new Map(meta.map((m) => [m.date, m]));
  const lastUpdated = meta.reduce<Date | null>((a, m) => (!a || m.updatedAt > a ? m.updatedAt : a), null);
  return { thresholds, result: computeCpaMonth(rows, thresholds), notes, lastUpdated };
}

/** データが存在する月（新しい順）。無ければ今月だけ */
export async function getCpaMonths(currentMonth: string): Promise<string[]> {
  const rows = await prisma.cpaDaily.findMany({ select: { date: true } });
  const set = new Set(rows.map((r) => r.date.slice(0, 7)));
  set.add(currentMonth);
  return [...set].sort().reverse();
}
