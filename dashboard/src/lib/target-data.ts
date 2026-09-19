// 目標・予実管理のデータ取得。配分・判定は src/lib/metrics/daily-target.ts のみを使う（画面で独自計算しない）。
import { prisma } from './prisma';
import { getEventCalendar, eventCalendarMonths } from './events-calendar';
import { fetchKpiMonths, type KpiDailyRow } from './pro/kpi-kintone';
import {
  computeDailyTargets,
  daysInMonthOf,
  judgeAgainstTarget,
  targetRate,
  totalWeight,
  type DayTarget,
  type EventCalendar,
  type TargetJudgement,
} from './metrics/daily-target';
import type { MetricValue } from './metrics/types';

export interface TargetDayRow extends DayTarget {
  /** その日の実績（売上合計）。データが無い日は null */
  actual: number | null;
  /** 実績 − 日次目標（メイン）。実績が無ければ null */
  diff: number | null;
  /** 実績の累計。データが無い日は null */
  cumulativeActual: number | null;
  /** 累計実績 − 累計目標 */
  cumulativeDiff: number | null;
  rate: MetricValue;
  judgement: TargetJudgement;
  /** 日別目標がKPI報告に入力されていた場合はその値（カレンダー配分より優先） */
  reportedTarget: number | null;
}

export interface TargetMonth {
  month: string;
  /** カレンダー未設定の月は null（画面は「未設定」を出す） */
  calendar: EventCalendar | null;
  daysInMonth: number;
  totalWeight: number;
  rows: TargetDayRow[];
  /** 実績が入っている日数 */
  actualDays: number;
  monthToDate: number;
  /** 経過日までの累計目標 */
  targetToDate: number;
  achievementRate: MetricValue;
  /** 累計実績 ÷ 経過日までの累計目標（1.0で計画どおり） */
  paceToDate: MetricValue;
  /** 残り日数（カレンダー上で実績が無い日） */
  remainingDays: number;
  /** 残り日数で月間目標に届くのに必要な日販 */
  requiredDaily: MetricValue;
  /** 実績の最終日 */
  latestDate: string | null;
  /** 実績の出どころ */
  source: 'kintone' | 'cache' | null;
  unavailableReason: string | null;
  /** DBのTargetテーブルに当月の登録があるか（あればカレンダーより優先して月間目標に使う） */
  dbTarget: { main: number | null; stretch: number | null };
}

const na = (reason: string): MetricValue => ({ kind: 'na', reason });

async function loadDbTarget(month: string): Promise<{ main: number | null; stretch: number | null }> {
  // Target テーブルに demo フラグが無いため、実データ（demo=false の受注）が1件も無い間は
  // デモシードの目標値を使わない（src/lib/pro/overview.ts の loadTargets と同じ方針）
  const realOrders = await prisma.order.count({ where: { demo: false } });
  if (realOrders === 0) return { main: null, stretch: null };
  const rows = await prisma.target.findMany({
    where: { month, scope: 'all', scopeCode: 'all', metric: { in: ['sales', 'sales_stretch'] } },
    select: { metric: true, amount: true },
  });
  return {
    main: rows.find((r) => r.metric === 'sales')?.amount ?? null,
    stretch: rows.find((r) => r.metric === 'sales_stretch')?.amount ?? null,
  };
}

/** 月の予実（日別目標＋実績）。実績が取れない場合も目標だけは返す */
export async function getTargetMonth(month: string): Promise<TargetMonth> {
  const baseCalendar = getEventCalendar(month);
  const dbTarget = await loadDbTarget(month).catch(() => ({ main: null, stretch: null }));

  // 月間目標は「目標・予実管理の登録値（Target）」が最優先、無ければカレンダーの値
  const calendar: EventCalendar | null = baseCalendar
    ? {
        ...baseCalendar,
        targets: {
          main: dbTarget.main ?? baseCalendar.targets.main,
          stretch: dbTarget.stretch ?? baseCalendar.targets.stretch,
        },
      }
    : null;

  let kpiRows: KpiDailyRow[] = [];
  let source: 'kintone' | 'cache' | null = null;
  let unavailableReason: string | null = null;
  const res = await fetchKpiMonths(month).catch(() => null);
  if (res && res.status === 'ok') {
    kpiRows = res.rows;
    source = res.source;
  } else {
    unavailableReason = res && res.status === 'unavailable' ? res.reason : '実績の取得に失敗しました';
  }
  const actualByDate = new Map(kpiRows.map((r) => [r.date, r]));

  const days = calendar ? computeDailyTargets(calendar) : [];
  const rows: TargetDayRow[] = [];
  let cumActual = 0;
  let seenAny = false;
  for (const d of days) {
    const rec = actualByDate.get(d.date);
    const actual = rec ? rec.salesTotal : null;
    if (actual != null) {
      cumActual += actual;
      seenAny = true;
    }
    const reportedTarget = rec?.target ?? null;
    const effectiveTarget = reportedTarget ?? d.main;
    rows.push({
      ...d,
      actual,
      reportedTarget,
      diff: actual == null ? null : actual - effectiveTarget,
      cumulativeActual: seenAny ? cumActual : null,
      cumulativeDiff: seenAny ? cumActual - d.cumulativeMain : null,
      rate: actual == null ? na('未取込') : targetRate(actual, effectiveTarget),
      judgement: actual == null ? 'na' : judgeAgainstTarget(actual, effectiveTarget),
    });
  }

  const withActual = rows.filter((r) => r.actual != null);
  const latestDate = withActual.length ? withActual[withActual.length - 1].date : null;
  const monthToDate = withActual.reduce((s, r) => s + (r.actual ?? 0), 0);
  const targetToDate = latestDate ? (rows.find((r) => r.date === latestDate)?.cumulativeMain ?? 0) : 0;
  const daysInMonth = calendar ? daysInMonthOf(month) : daysInMonthOf(month);
  const remainingDays = Math.max(0, daysInMonth - (latestDate ? Number(latestDate.slice(8, 10)) : 0));
  const monthMain = calendar?.targets.main ?? null;

  return {
    month,
    calendar,
    daysInMonth,
    totalWeight: calendar ? totalWeight(calendar) : 0,
    rows,
    actualDays: withActual.length,
    monthToDate,
    targetToDate,
    achievementRate: monthMain ? targetRate(monthToDate, monthMain) : na('目標未設定'),
    paceToDate: targetToDate > 0 ? { kind: 'value', value: monthToDate / targetToDate } : na('実績なし'),
    remainingDays,
    requiredDaily:
      monthMain == null
        ? na('目標未設定')
        : remainingDays <= 0
          ? na('月末確定')
          : { kind: 'value', value: Math.max(0, Math.round((monthMain - monthToDate) / remainingDays)) },
    latestDate,
    source,
    unavailableReason,
    dbTarget,
  };
}

/** 画面の月切替に出す月（カレンダーがある月＋実績がある月） */
export async function getTargetMonths(currentMonth: string): Promise<string[]> {
  const set = new Set(eventCalendarMonths());
  set.add(currentMonth);
  try {
    const rows = await prisma.kpiDaily.findMany({ select: { date: true } });
    for (const r of rows) set.add(r.date.slice(0, 7));
  } catch {
    /* DB未接続でもカレンダーの月は出す */
  }
  return [...set].sort().reverse();
}
