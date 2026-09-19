// イベント日加重の日別目標（純関数）。他画面（/sales・/targets・将来の /pro）が共通で使う。
// 出典: docs/business.md §6「日次目標 = 月目標 × その日の重み ÷ 月内の重み合計」
//       重み: 通常1.0／楽天マラソン1.7／楽天スーパーSALE・Amazonスマイルセール2.0／イベント最終日1.2〜1.3
//       日次判定: 売上 ÷ 日次目標 ≥1.0 🟢好調 / ≥0.7 🟡まずまず / 未満 🔴要改善
// 重みの正は Setting `targets.weights.<YYYY-MM>`（JSON）。初期値は daily-report-system/config/chorei/events-YYYY-MM.json。
import type { MetricValue } from './types';

/** 1日分の重み（ラベルはイベント名。通常日は空） */
export interface DayWeight {
  label: string;
  weight: number;
}

/** キーは月内の日 "1"〜"31"（events-YYYY-MM.json と同じ形） */
export type WeightMap = Record<string, DayWeight>;

/** 重みの既定値（通常日） */
export const DEFAULT_WEIGHT = 1.0;

/** 日次判定の閾値（business.md §6） */
export const DAILY_JUDGE = { ok: 1.0, warn: 0.7 } as const;

export type DailyJudgement = 'ok' | 'warn' | 'danger' | 'na';

export const DAILY_JUDGE_JA: Record<DailyJudgement, string> = {
  ok: '好調',
  warn: 'まずまず',
  danger: '要改善',
  na: '−',
};

export interface DailyTarget {
  /** YYYY-MM-DD */
  date: string;
  /** 月内の日（1〜31） */
  day: number;
  label: string;
  weight: number;
  /** 円・整数。月合計が月間目標と一致するよう累積丸めで配分 */
  target: number;
}

export interface DailyCompareRow extends DailyTarget {
  /** 実績（その日のKPI報告が無ければ null） */
  actual: number | null;
  /** 実績 ÷ 日別目標（%） */
  achievement: MetricValue;
  /** 実績 − 日別目標（円）。実績無しは null */
  gap: number | null;
  judgement: DailyJudgement;
  /** 実績のある日までの累計 */
  cumActual: number | null;
  /** 1日〜その日までの日別目標の累計 */
  cumTarget: number;
  /** 累計実績 − 累計目標。実績無しは null */
  cumGap: number | null;
}

export interface DailyCompareSummary {
  month: string;
  daysInMonth: number;
  /** 月間目標（配分元） */
  monthTarget: number;
  /** 月内の重み合計 */
  weightTotal: number;
  /** 重みが 1.0 以外の日数（イベント日数） */
  eventDays: number;
  /** 実績のある日数 */
  dataDays: number;
  latestDate: string | null;
  /** 最新データ日までの累計実績 */
  actualToDate: number;
  /** 最新データ日までの加重目標の累計 */
  targetToDate: number;
  /** 累計実績 − 累計加重目標 */
  gapToDate: MetricValue;
  /** 累計実績 ÷ 累計加重目標（%） */
  achievementToDate: MetricValue;
  /** 累計実績 ÷ 月間目標（%） */
  achievementOfMonth: MetricValue;
  /** 判定日数の内訳 */
  days: Record<Exclude<DailyJudgement, 'na'>, number>;
  rows: DailyCompareRow[];
}

const na = (reason: string): MetricValue => ({ kind: 'na', reason });
const val = (value: number): MetricValue => ({ kind: 'value', value });

function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isValidWeight(w: unknown): w is number {
  return typeof w === 'number' && Number.isFinite(w) && w > 0;
}

/**
 * Setting の JSON 文字列 → WeightMap。壊れていれば {}（推測で埋めない）。
 * 受け付ける形: { "1": {"label":"…","weight":2.0}, "19": {"weight":1.7}, "5": 2.0 }
 */
export function parseWeights(json: string | null | undefined): WeightMap {
  if (!json) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return {};
  }
  return normalizeWeights(obj);
}

/** 任意のオブジェクトを WeightMap に正規化（不正な日・重みは捨てる） */
export function normalizeWeights(obj: unknown): WeightMap {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: WeightMap = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    if (isValidWeight(v)) {
      out[String(day)] = { label: '', weight: v };
      continue;
    }
    if (v && typeof v === 'object') {
      const w = (v as { weight?: unknown }).weight;
      const label = (v as { label?: unknown }).label;
      if (!isValidWeight(w)) continue;
      out[String(day)] = { label: typeof label === 'string' ? label.trim() : '', weight: w };
    }
  }
  return out;
}

/** events-YYYY-MM.json の内容 */
export interface EventsCalendar {
  month: string;
  targets: { main: number; stretch: number } | null;
  note: string | null;
  weights: WeightMap;
}

/** daily-report-system/config/chorei/events-YYYY-MM.json をパース。形が違えば null */
export function parseEventsCalendar(obj: unknown): EventsCalendar | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as { month?: unknown; targets?: unknown; events?: unknown; note?: unknown };
  if (typeof o.month !== 'string' || !/^\d{4}-\d{2}$/.test(o.month)) return null;
  const t = o.targets as { main?: unknown; stretch?: unknown } | undefined;
  const targets =
    t && isValidWeight(t.main) && isValidWeight(t.stretch) ? { main: Math.round(t.main), stretch: Math.round(t.stretch) } : null;
  return {
    month: o.month,
    targets,
    note: typeof o.note === 'string' ? o.note : null,
    weights: normalizeWeights(o.events),
  };
}

/** 保存用: 通常日（重み1.0・ラベル無し）は省いて JSON にする */
export function serializeWeights(weights: WeightMap): string {
  const out: WeightMap = {};
  for (const [k, v] of Object.entries(weights)) {
    if (v.weight === DEFAULT_WEIGHT && !v.label) continue;
    out[k] = { label: v.label, weight: v.weight };
  }
  const keys = Object.keys(out).sort((a, b) => Number(a) - Number(b));
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, out[k]])));
}

/** 月内の重み合計（未指定の日は 1.0） */
export function weightTotal(month: string, weights: WeightMap): number {
  const n = daysIn(month);
  let s = 0;
  for (let d = 1; d <= n; d++) s += weights[String(d)]?.weight ?? DEFAULT_WEIGHT;
  return s;
}

/**
 * 日別目標 = 月間目標 × その日の重み ÷ 月内の重み合計。
 * 円・整数に丸めるとき、月合計が月間目標とちょうど一致するよう「累積の丸めの差分」で配分する。
 * 月間目標が 0 以下なら全日 0（目標未設定）。
 */
export function buildDailyTargets(month: string, monthTarget: number, weights: WeightMap): DailyTarget[] {
  const n = daysIn(month);
  const total = weightTotal(month, weights);
  const out: DailyTarget[] = [];
  let cum = 0;
  let prevRounded = 0;
  for (let d = 1; d <= n; d++) {
    const w = weights[String(d)];
    const weight = w?.weight ?? DEFAULT_WEIGHT;
    let target = 0;
    if (monthTarget > 0 && total > 0) {
      cum += (monthTarget * weight) / total;
      const rounded = Math.round(cum);
      target = rounded - prevRounded;
      prevRounded = rounded;
    }
    out.push({ date: `${month}-${String(d).padStart(2, '0')}`, day: d, label: w?.label ?? '', weight, target });
  }
  return out;
}

/** 日次判定（business.md §6）: 実績÷目標 ≥1.0 ok / ≥0.7 warn / 未満 danger。目標0・実績無しは na */
export function judgeDaily(actual: number | null, target: number): DailyJudgement {
  if (actual == null || target <= 0) return 'na';
  const r = actual / target;
  if (r >= DAILY_JUDGE.ok) return 'ok';
  if (r >= DAILY_JUDGE.warn) return 'warn';
  return 'danger';
}

/** 実績行（KpiDailyRow のサブセット） */
export interface ActualRow {
  date: string;
  salesTotal: number;
}

/**
 * 日別目標と日別実績（KPI報告）を並べる。実績の無い日（未来・未取込）は actual=null のまま（0にしない）。
 */
export function compareDailyTargets(month: string, monthTarget: number, weights: WeightMap, actuals: ActualRow[]): DailyCompareSummary {
  const targets = buildDailyTargets(month, monthTarget, weights);
  const byDate = new Map<string, number>();
  for (const a of actuals) if (a.date.startsWith(month + '-')) byDate.set(a.date, a.salesTotal);
  const latestDate = [...byDate.keys()].sort().pop() ?? null;

  let cumActual = 0;
  let cumTarget = 0;
  let actualToDate = 0;
  let targetToDate = 0;
  const days = { ok: 0, warn: 0, danger: 0 };
  const rows: DailyCompareRow[] = targets.map((t) => {
    const actual = byDate.has(t.date) ? (byDate.get(t.date) as number) : null;
    cumTarget += t.target;
    if (actual != null) cumActual += actual;
    if (latestDate && t.date <= latestDate) {
      targetToDate = cumTarget;
      actualToDate = cumActual;
    }
    const judgement = judgeDaily(actual, t.target);
    if (judgement !== 'na') days[judgement]++;
    const achievement: MetricValue =
      actual == null ? na('実績なし') : t.target <= 0 ? na('目標未設定') : val((actual / t.target) * 100);
    return {
      ...t,
      actual,
      achievement,
      gap: actual == null ? null : actual - t.target,
      judgement,
      cumActual: actual == null ? null : cumActual,
      cumTarget,
      cumGap: actual == null ? null : cumActual - cumTarget,
    };
  });

  const noData = !latestDate;
  return {
    month,
    daysInMonth: targets.length,
    monthTarget,
    weightTotal: weightTotal(month, weights),
    eventDays: targets.filter((t) => t.weight !== DEFAULT_WEIGHT).length,
    dataDays: byDate.size,
    latestDate,
    actualToDate,
    targetToDate,
    gapToDate: noData ? na('データなし') : monthTarget <= 0 ? na('目標未設定') : val(actualToDate - targetToDate),
    achievementToDate: noData ? na('データなし') : targetToDate <= 0 ? na('目標未設定') : val((actualToDate / targetToDate) * 100),
    achievementOfMonth: noData ? na('データなし') : monthTarget <= 0 ? na('目標未設定') : val((actualToDate / monthTarget) * 100),
    days,
    rows,
  };
}
