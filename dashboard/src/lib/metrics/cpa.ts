// 合算CPA（スーツケース）の計算。docs/metrics.md「合算CPA」が正。
// 画面・レポートはこのモジュールの結果だけを表示し、独自計算をしない。
import type { MetricValue } from './types';

export interface CpaDailyRow {
  /** JST暦日 YYYY-MM-DD */
  date: string;
  /** スーツケース系売上（税込・全チャネル）。未取得は null */
  suitcaseSales: number | null;
  meta: number;
  amazonAds: number;
  rpp: number;
  google: number;
  other: number;
  unitsAmazon: number;
  unitsRakuten: number;
  unitsOwn: number;
}

export interface CpaThresholds {
  /** 想定客単価（税込・全チャネル平均） */
  aov: number;
  /** 目標 広告比率（0.15 = 15%） */
  targetRatio: number;
  /** 許容 広告比率（0.20 = 20%） */
  limitRatio: number;
}

export const DEFAULT_CPA_THRESHOLDS: CpaThresholds = { aov: 30000, targetRatio: 0.15, limitRatio: 0.2 };

/** pass=合格 / warn=注意 / over=超過 / na=判定不可（個数0など） */
export type CpaJudgement = 'pass' | 'warn' | 'over' | 'na';

export const JUDGEMENT_JA: Record<CpaJudgement, string> = {
  pass: '合格',
  warn: '注意',
  over: '超過',
  na: '−',
};

export interface CpaDayResult {
  date: string;
  adTotal: number;
  units: number;
  suitcaseSales: number | null;
  /** 合算CPA = 合算広告費 ÷ 販売個数 */
  cpa: MetricValue;
  /** 広告比率 = 合算広告費 ÷ スーツケース売上（%） */
  ratio: MetricValue;
  judgement: CpaJudgement;
  ratioJudgement: CpaJudgement;
  /** 直近7日（当日含む）の合算CPA */
  moving7: MetricValue;
  /** 広告費も個数も未入力の行 */
  empty: boolean;
  /** 入力値（内訳表示用） */
  raw: CpaDailyRow;
}

export interface CpaMonthResult {
  targetCpa: number;
  limitCpa: number;
  adTotal: number;
  units: number;
  sales: number | null;
  cpa: MetricValue;
  ratio: MetricValue;
  judgement: CpaJudgement;
  ratioJudgement: CpaJudgement;
  days: { pass: number; warn: number; over: number };
  /** 入力済みの日数 */
  filledDays: number;
  byMedia: { meta: number; amazonAds: number; rpp: number; google: number; other: number };
  byChannel: { amazon: number; rakuten: number; own: number };
  rows: CpaDayResult[];
}

export function thresholdCpa(t: CpaThresholds): { targetCpa: number; limitCpa: number } {
  return { targetCpa: t.aov * t.targetRatio, limitCpa: t.aov * t.limitRatio };
}

export function judgeCpa(cpa: MetricValue, t: CpaThresholds): CpaJudgement {
  if (cpa.kind === 'na') return 'na';
  const { targetCpa, limitCpa } = thresholdCpa(t);
  if (cpa.value <= targetCpa) return 'pass';
  if (cpa.value <= limitCpa) return 'warn';
  return 'over';
}

export function judgeRatio(ratioPct: MetricValue, t: CpaThresholds): CpaJudgement {
  if (ratioPct.kind === 'na') return 'na';
  if (ratioPct.value <= t.targetRatio * 100) return 'pass';
  if (ratioPct.value <= t.limitRatio * 100) return 'warn';
  return 'over';
}

export function adTotalOf(r: CpaDailyRow): number {
  return (r.meta || 0) + (r.amazonAds || 0) + (r.rpp || 0) + (r.google || 0) + (r.other || 0);
}

export function unitsOf(r: CpaDailyRow): number {
  return (r.unitsAmazon || 0) + (r.unitsRakuten || 0) + (r.unitsOwn || 0);
}

function divide(num: number, den: number, naReason: string): MetricValue {
  if (!den) return { kind: 'na', reason: naReason };
  return { kind: 'value', value: num / den };
}

export function computeCpaDay(r: CpaDailyRow, t: CpaThresholds): Omit<CpaDayResult, 'moving7'> {
  const adTotal = adTotalOf(r);
  const units = unitsOf(r);
  const empty = adTotal === 0 && units === 0;
  const cpa = empty ? { kind: 'na' as const, reason: '未入力' } : divide(adTotal, units, '個数0');
  const ratio: MetricValue = empty
    ? { kind: 'na', reason: '未入力' }
    : r.suitcaseSales == null
      ? { kind: 'na', reason: '売上未取得' }
      : r.suitcaseSales === 0
        ? { kind: 'na', reason: '売上0' }
        : { kind: 'value', value: (adTotal / r.suitcaseSales) * 100 };
  return {
    date: r.date,
    adTotal,
    units,
    suitcaseSales: r.suitcaseSales,
    cpa,
    ratio,
    judgement: judgeCpa(cpa, t),
    ratioJudgement: judgeRatio(ratio, t),
    empty,
    raw: r,
  };
}

/** 月内の行（日付昇順でなくてもよい）から月次結果を作る */
export function computeCpaMonth(rows: CpaDailyRow[], t: CpaThresholds): CpaMonthResult {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const days = sorted.map((r) => computeCpaDay(r, t));
  const out: CpaDayResult[] = days.map((d, i) => {
    if (d.empty) return { ...d, moving7: { kind: 'na', reason: '未入力' } };
    // 直近7日（暦日ベース・当日含む）の入力済み行で集計
    const from = shiftDate(d.date, -6);
    let ad = 0;
    let u = 0;
    for (let j = 0; j <= i; j++) {
      const x = days[j];
      if (x.empty || x.date < from) continue;
      ad += x.adTotal;
      u += x.units;
    }
    return { ...d, moving7: divide(ad, u, '個数0') };
  });
  const filled = out.filter((d) => !d.empty);
  const adTotal = filled.reduce((a, d) => a + d.adTotal, 0);
  const units = filled.reduce((a, d) => a + d.units, 0);
  const salesRows = filled.filter((d) => d.suitcaseSales != null);
  const sales = salesRows.length ? salesRows.reduce((a, d) => a + (d.suitcaseSales || 0), 0) : null;
  const cpa = filled.length ? divide(adTotal, units, '個数0') : { kind: 'na' as const, reason: '未入力' };
  const ratio: MetricValue =
    sales == null
      ? { kind: 'na', reason: '売上未取得' }
      : sales === 0
        ? { kind: 'na', reason: '売上0' }
        : { kind: 'value', value: (adTotal / sales) * 100 };
  const src = sorted.filter((r) => !(adTotalOf(r) === 0 && unitsOf(r) === 0));
  const sum = (k: keyof CpaDailyRow) => src.reduce((a, r) => a + ((r[k] as number) || 0), 0);
  return {
    ...thresholdCpa(t),
    adTotal,
    units,
    sales,
    cpa,
    ratio,
    judgement: judgeCpa(cpa, t),
    ratioJudgement: judgeRatio(ratio, t),
    days: {
      pass: filled.filter((d) => d.judgement === 'pass').length,
      warn: filled.filter((d) => d.judgement === 'warn').length,
      over: filled.filter((d) => d.judgement === 'over').length,
    },
    filledDays: filled.length,
    byMedia: { meta: sum('meta'), amazonAds: sum('amazonAds'), rpp: sum('rpp'), google: sum('google'), other: sum('other') },
    byChannel: { amazon: sum('unitsAmazon'), rakuten: sum('unitsRakuten'), own: sum('unitsOwn') },
    rows: out,
  };
}

/** YYYY-MM-DD を n 日ずらす（UTCで計算し暦日文字列だけ扱う） */
export function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + n);
  return new Date(t).toISOString().slice(0, 10);
}

/** 月 YYYY-MM の全日付 */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
