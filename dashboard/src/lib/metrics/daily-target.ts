// 日別目標（イベント加重）。朝礼（daily-report-system/scripts/newsDaily.py・buildChoreiSheet.py）と同じ式を使う。
//   日次目標 = 月間目標 × その日の重み ÷ 月内の重みの合計
//   重みは events-YYYY-MM.json（通常1.0／楽天マラソン1.7／スーパーSALE・Amazonスマイルセール2.0／
//   イベント最終日は深夜・朝クローズのため1.2〜1.3）。カレンダーが正で、推測で重みを作らない。
// 判定も朝礼と一致させる: 達成率 1.0以上=好調 / 0.7以上=まずまず / 未満=要改善。
import type { MetricValue } from './types';

export interface EventDay {
  label: string;
  weight: number;
}

export interface EventCalendar {
  /** YYYY-MM */
  month: string;
  targets: { main: number; stretch: number };
  /** キーは「日」（"1"〜"31"）。未記載の日は重み1.0 */
  events: Record<string, EventDay>;
  note?: string;
}

export interface DayTarget {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  label: string;
  weight: number;
  /** メイン目標の日割り（円・四捨五入） */
  main: number;
  /** ストレッチ目標の日割り（円・四捨五入） */
  stretch: number;
  /** 1日からの累計（メイン） */
  cumulativeMain: number;
  cumulativeStretch: number;
}

/** 朝礼と同じ3段階。good=🟢好調 / fair=🟡まずまず / poor=🔴要改善 / na=判定不可 */
export type TargetJudgement = 'good' | 'fair' | 'poor' | 'na';

export const TARGET_JUDGEMENT_JA: Record<TargetJudgement, string> = {
  good: '好調',
  fair: 'まずまず',
  poor: '要改善',
  na: '−',
};

/** 朝礼の判定しきい値（変更するとダッシュボードと朝礼がズレるので注意） */
export const GOOD_RATE = 1.0;
export const FAIR_RATE = 0.7;

export function daysInMonthOf(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** JSON（events-YYYY-MM.json）を検証して読む。壊れていれば null（数字を作らない） */
export function parseEventCalendar(raw: unknown): EventCalendar | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const month = typeof o.month === 'string' && /^\d{4}-\d{2}$/.test(o.month) ? o.month : null;
  const t = o.targets as { main?: unknown; stretch?: unknown } | undefined;
  const main = typeof t?.main === 'number' && t.main > 0 ? t.main : null;
  if (!month || main == null) return null;
  const stretch = typeof t?.stretch === 'number' && t.stretch > 0 ? t.stretch : main;
  const events: Record<string, EventDay> = {};
  const src = (o.events ?? {}) as Record<string, unknown>;
  const dim = daysInMonthOf(month);
  for (const [k, v] of Object.entries(src)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 1 || day > dim) continue;
    const e = v as { label?: unknown; weight?: unknown };
    const weight = typeof e?.weight === 'number' && e.weight > 0 ? e.weight : 1;
    events[String(day)] = { label: typeof e?.label === 'string' ? e.label : '', weight };
  }
  return { month, targets: { main, stretch }, events, note: typeof o.note === 'string' ? o.note : undefined };
}

/** その日の重み（未記載は1.0） */
export function weightOf(cal: EventCalendar, day: number): number {
  return cal.events[String(day)]?.weight ?? 1;
}

/** 月内の重みの合計（分母） */
export function totalWeight(cal: EventCalendar): number {
  const dim = daysInMonthOf(cal.month);
  let sum = 0;
  for (let d = 1; d <= dim; d++) sum += weightOf(cal, d);
  return sum;
}

/** 月の全日について日別目標を出す（朝礼・目標乖離シートと同じ配分） */
export function computeDailyTargets(cal: EventCalendar): DayTarget[] {
  const dim = daysInMonthOf(cal.month);
  const w = totalWeight(cal);
  const out: DayTarget[] = [];
  let cumMain = 0;
  let cumStretch = 0;
  for (let d = 1; d <= dim; d++) {
    const weight = weightOf(cal, d);
    const main = w > 0 ? Math.round((cal.targets.main * weight) / w) : 0;
    const stretch = w > 0 ? Math.round((cal.targets.stretch * weight) / w) : 0;
    cumMain += main;
    cumStretch += stretch;
    out.push({
      date: `${cal.month}-${String(d).padStart(2, '0')}`,
      day: d,
      label: cal.events[String(d)]?.label ?? '',
      weight,
      main,
      stretch,
      cumulativeMain: cumMain,
      cumulativeStretch: cumStretch,
    });
  }
  return out;
}

/** 日付→日別目標（メイン）の早見表 */
export function dailyTargetMap(cal: EventCalendar): Map<string, number> {
  return new Map(computeDailyTargets(cal).map((d) => [d.date, d.main]));
}

/** 達成率（%）。目標0・未設定は「目標未設定」 */
export function targetRate(actual: number, target: number | null | undefined): MetricValue {
  if (target == null || target <= 0) return { kind: 'na', reason: '目標未設定' };
  return { kind: 'value', value: (actual / target) * 100 };
}

/** 朝礼と同じ判定（1.0以上=好調 / 0.7以上=まずまず / 未満=要改善） */
export function judgeAgainstTarget(actual: number, target: number | null | undefined): TargetJudgement {
  if (target == null || target <= 0) return 'na';
  const rate = actual / target;
  if (rate >= GOOD_RATE) return 'good';
  if (rate >= FAIR_RATE) return 'fair';
  return 'poor';
}
