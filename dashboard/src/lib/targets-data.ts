// 目標・予実管理（/targets）と売上・利益（/sales）が共有するデータ取得。計算は src/lib/metrics/daily-targets.ts に委ねる。
// - 月間目標: Target テーブル（month / scope='all' / scopeCode='all' / metric='sales'|'sales_stretch'）
//   updatedBy が無い行は prisma/seed.ts のデモシード由来とみなし、集計には使わない（画面に「シード値・未確認」と出す）。
//   未登録のときは現場の既定値 1.1億／1.2億（docs/business.md §6・仮置き）を isDefault=true で返す。
// - 日別の重み: Setting `targets.weights.<YYYY-MM>`（JSON）。未保存の月は同梱のイベントカレンダー
//   `src/data/events/events-<YYYY-MM>.json`（朝礼の daily-report-system/config/chorei のコピー。`sh scripts/sync-events.sh` で更新）の重みを既定値にする。
//   PRO 経営ダッシュボード（overview.ts）も getEffectiveDailyTargetMap を使うため、/targets・/sales・PRO トップの日別目標は常に同じ値になる。
import { prisma } from './prisma';
import { THRESHOLDS } from './pro/overview';
import { daysInMonthOf, fetchKpiMonths, type KpiDailyRow, type KpiFetchResult, type MonthTargets } from './pro/kpi-kintone';
import { buildDailyTargets, parseEventsCalendar, parseWeights, type EventsCalendar, type WeightMap } from './metrics/daily-targets';
import { EVENT_CALENDARS } from '@/data/events';

export const TARGET_METRIC = { main: 'sales', stretch: 'sales_stretch' } as const;

export function weightsSettingKey(month: string): string {
  return `targets.weights.${month}`;
}

export interface MonthTargetsDetail extends MonthTargets {
  /** 保存済みの値（updatedBy あり）。無ければ null */
  saved: { main: number | null; stretch: number | null };
  /** デモシード由来（updatedBy 無し）の値。集計には使わない */
  seed: { main: number | null; stretch: number | null };
  updatedBy: string | null;
  updatedAt: Date | null;
}

export async function getMonthTargets(month: string): Promise<MonthTargetsDetail> {
  const rows = await prisma.target.findMany({
    where: { month, scope: 'all', scopeCode: 'all', metric: { in: [TARGET_METRIC.main, TARGET_METRIC.stretch] } },
    select: { metric: true, amount: true, updatedBy: true, updatedAt: true },
  });
  const pick = (metric: string) => rows.find((r) => r.metric === metric) ?? null;
  const m = pick(TARGET_METRIC.main);
  const s = pick(TARGET_METRIC.stretch);
  const savedMain = m && m.updatedBy ? m.amount : null;
  const savedStretch = s && s.updatedBy ? s.amount : null;
  const latest = [m, s].filter((r) => r && r.updatedBy).sort((a, b) => (b!.updatedAt.getTime() - a!.updatedAt.getTime()))[0] ?? null;
  return {
    main: savedMain ?? THRESHOLDS.targetMainDefault,
    stretch: savedStretch ?? THRESHOLDS.targetStretchDefault,
    isDefault: savedMain == null,
    saved: { main: savedMain, stretch: savedStretch },
    seed: { main: m && !m.updatedBy ? m.amount : null, stretch: s && !s.updatedBy ? s.amount : null },
    updatedBy: latest?.updatedBy ?? null,
    updatedAt: latest?.updatedAt ?? null,
  };
}

export interface WeightsDetail {
  weights: WeightMap;
  /** Setting に保存済みか */
  exists: boolean;
  key: string;
  /** 重みの出どころ: setting=画面で保存した値 / calendar=同梱イベントカレンダーの既定値 / default=どちらも無く全日1.0 */
  source: 'setting' | 'calendar' | 'default';
}

export async function getWeights(month: string): Promise<WeightsDetail> {
  const key = weightsSettingKey(month);
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) return { weights: parseWeights(row.value), exists: true, key, source: 'setting' };
  const cal = await readEventsCalendar(month);
  if (cal.status === 'ok') return { weights: cal.calendar.weights, exists: false, key, source: 'calendar' };
  return { weights: {}, exists: false, key, source: 'default' };
}

/** 同梱イベントカレンダーの識別（画面表示用） */
export function eventsCalendarPath(month: string): string {
  return `src/data/events/events-${month}.json`;
}

export type EventsCalendarResult =
  | { status: 'ok'; path: string; calendar: EventsCalendar }
  | { status: 'missing'; path: string }
  | { status: 'invalid'; path: string; reason: string };

/** 同梱のイベントカレンダー（朝礼と同じ JSON のコピー）を読む。月が無ければ missing */
export async function readEventsCalendar(month: string): Promise<EventsCalendarResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { status: 'invalid', path: '', reason: '月の形式が不正です' };
  const p = eventsCalendarPath(month);
  const raw = EVENT_CALENDARS[month];
  if (!raw) return { status: 'missing', path: p };
  const cal = parseEventsCalendar(raw);
  if (!cal) return { status: 'invalid', path: p, reason: 'month / events の形が想定と違います' };
  if (cal.month !== month) return { status: 'invalid', path: p, reason: `ファイルの month (${cal.month}) が対象月と一致しません` };
  return { status: 'ok', path: p, calendar: cal };
}

/** 同梱カレンダーにその月があるか（画面のボタン表示用） */
export async function eventsCalendarAvailable(month: string): Promise<boolean> {
  return Boolean(EVENT_CALENDARS[month]);
}

/**
 * 日付 → 日別目標（円）。月間目標（保存値、無ければ既定 1.1億）× 重み（保存値、無ければカレンダー、無ければ全日1.0）。
 * PRO 経営ダッシュボードと /sales・/targets で共通に使う唯一の入口。
 */
export async function getEffectiveDailyTargetMap(month: string): Promise<Map<string, number>> {
  const [targets, w] = await Promise.all([getMonthTargets(month), getWeights(month)]);
  return new Map(buildDailyTargets(month, targets.main, w.weights).map((d) => [d.date, d.target]));
}

/** YYYY-MM の翌月 */
export function nextMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** KPI日次データがある月（降順）。当月は無くても含める */
export async function getKpiMonths(thisMonth: string): Promise<string[]> {
  const rows = await prisma.kpiDaily.findMany({ select: { date: true }, distinct: ['date'], orderBy: { date: 'desc' } });
  const set = new Set<string>([thisMonth, ...rows.map((r) => r.date.slice(0, 7))]);
  return [...set].sort().reverse();
}

/** 目標画面の月切替: KPIのある月 ∪ 目標・重みを登録済みの月 ∪ 当月 ∪ 翌月（翌月の目標を先に入れられるように） */
export async function getTargetMonths(thisMonth: string): Promise<string[]> {
  const [kpi, targets, settings] = await Promise.all([
    getKpiMonths(thisMonth),
    prisma.target.findMany({ where: { scope: 'all', scopeCode: 'all', metric: { in: [TARGET_METRIC.main, TARGET_METRIC.stretch] } }, select: { month: true }, distinct: ['month'] }),
    prisma.setting.findMany({ where: { key: { startsWith: 'targets.weights.' } }, select: { key: true } }),
  ]);
  const set = new Set<string>([...kpi, nextMonthOf(thisMonth), ...targets.map((t) => t.month)]);
  for (const s of settings) {
    const m = s.key.slice('targets.weights.'.length);
    if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
  }
  return [...set].sort().reverse();
}

/** KPI日次（Kintone または日次キャッシュ）。当月・前月をまとめて返す */
export async function getKpiRows(month: string): Promise<{ result: KpiFetchResult; rows: KpiDailyRow[]; prevRows: KpiDailyRow[] }> {
  const result = await fetchKpiMonths(month);
  if (result.status === 'ok') return { result, rows: result.rows, prevRows: result.prevRows };
  return { result, rows: [], prevRows: [] };
}

export { daysInMonthOf };
