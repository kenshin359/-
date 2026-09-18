// KPI（PRO）のデータ層。判定は docs/business.md §6「KPIと判定基準」の現場基準に合わせる。
// 値は KpiValue（手入力 or 将来の自動連携）。値が無い KPI は「未取得」として扱い、推測で埋めない。
import { prisma } from '../prisma';
import { jstDateKey } from '../metrics/format';
import { listTasks2, type Task2Item } from './tasks2';

export type KpiDirection = 'up' | 'down';

export interface KpiDef {
  code: string;
  name: string;
  unit: string; // 円 | % | 件 | 倍 | 個
  direction: KpiDirection;
  targetValue: number | null;
  warnThreshold: number | null;
  dangerThreshold: number | null;
  source: string; // metrics | kintone | manual
  teamCode: string | null;
  ownerUserId: string | null;
  note: string | null;
  active: boolean;
}

/**
 * 初期KPI（prisma.kpi が空のときだけ投入）。閾値の出典は docs/business.md §6。
 * down 方向は「閾値を超えたら」注意・危険（¥4,500 以下が🟢、¥6,000 以下が🟡、超えたら🔴 = buildCpaSheet.py と同じ <= 判定）。
 */
export const KPI_DEFAULTS: KpiDef[] = [
  {
    code: 'sales_month',
    name: '月間売上',
    unit: '円',
    direction: 'up',
    targetValue: 110_000_000,
    warnThreshold: null,
    dangerThreshold: null,
    source: 'manual',
    teamCode: 'ec',
    ownerUserId: null,
    note: 'メイン目標 1.1億円（docs/business.md §6 月間目標）。値は手入力（Kintone売上連携は未接続）',
    active: true,
  },
  {
    code: 'ad_ratio',
    name: '広告比率',
    unit: '%',
    direction: 'down',
    targetValue: 15,
    warnThreshold: 15,
    dangerThreshold: 20,
    source: 'manual',
    teamCode: 'ads',
    ownerUserId: null,
    note: '合算広告費 ÷ スーツケース売上（税込）。目標15% / 許容20%（docs/business.md §6 広告比率）',
    active: true,
  },
  {
    code: 'suitcase_cpa',
    name: '合算CPA',
    unit: '円',
    direction: 'down',
    targetValue: 4500,
    warnThreshold: 4500,
    dangerThreshold: 6000,
    source: 'manual',
    teamCode: 'ads',
    ownerUserId: null,
    note: '合算広告費 ÷ スーツケース販売個数。目標 ¥4,500🟢 / 許容 ¥6,000🟡 / 超過🔴（docs/business.md §6 合算CPA）',
    active: true,
  },
  {
    code: 'roas',
    name: 'ROAS',
    unit: '倍',
    direction: 'up',
    targetValue: null,
    warnThreshold: null,
    dangerThreshold: 2.0,
    source: 'manual',
    teamCode: 'ads',
    ownerUserId: null,
    note: '広告経由売上 ÷ 広告費。2.0未満で⚠️（docs/business.md §6 ROAS）。帰属売上未取得なら値を入れない（総売上÷広告費で代用しない）',
    active: true,
  },
  {
    code: 'cs_low_reviews',
    name: '低評価レビュー件数',
    unit: '件',
    direction: 'down',
    targetValue: null,
    warnThreshold: null,
    dangerThreshold: null,
    source: 'manual',
    teamCode: 'cs',
    ownerUserId: null,
    note: '星3以下 or 危険キーワードのレビュー件数（docs/business.md §6 レビュー）。閾値は未設定（要・現場基準）',
    active: true,
  },
  {
    code: 'overdue_tasks',
    name: '期限超過タスク',
    unit: '件',
    direction: 'down',
    targetValue: 0,
    warnThreshold: 0,
    dangerThreshold: 2,
    source: 'manual',
    teamCode: null,
    ownerUserId: null,
    note: '未完了かつ期限を過ぎたタスク数（docs/business.md §5.3 朝礼のタスクボード観点）。1件で注意・3件で危険（閾値は「超えたら」判定のため 0 / 2 で登録）',
    active: true,
  },
];

export async function ensureKpiDefaults(): Promise<void> {
  const n = await prisma.kpi.count();
  if (n > 0) return;
  await prisma.kpi.createMany({ data: KPI_DEFAULTS });
}

// ---------- 判定（純関数） ----------
export type Judgment = 'green' | 'yellow' | 'red' | 'none' | 'na';
export const JUDGMENT_JA: Record<Judgment, string> = { green: '正常', yellow: '注意', red: '危険', none: '基準なし', na: '未取得' };

/**
 * down: 閾値を「超えたら」注意/危険（¥4,500以下🟢・¥6,000以下🟡・超🔴）。
 * up: 閾値を「下回ったら」注意/危険。閾値が無く目標だけある場合は 目標達成→正常 / 未達→注意。
 */
export function judgeKpi(
  k: Pick<KpiDef, 'direction' | 'targetValue' | 'warnThreshold' | 'dangerThreshold'>,
  value: number | null | undefined,
): Judgment {
  if (value == null || !Number.isFinite(value)) return 'na';
  const { warnThreshold: warn, dangerThreshold: danger, targetValue: target } = k;
  const bad = (th: number) => (k.direction === 'down' ? value > th : value < th);
  if (danger != null && bad(danger)) return 'red';
  if (warn != null && bad(warn)) return 'yellow';
  if (danger != null || warn != null) return 'green';
  if (target != null) return bad(target) ? 'yellow' : 'green';
  return 'none';
}

export function formatKpiValue(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(value)) return '未取得';
  switch (unit) {
    case '円':
      return `¥${Math.round(value).toLocaleString('ja-JP')}`;
    case '%':
      return `${value.toFixed(1)}%`;
    case '倍':
      return `${value.toFixed(2)}倍`;
    default:
      return `${Number.isInteger(value) ? value.toLocaleString('ja-JP') : value.toFixed(1)}${unit}`;
  }
}

/** 系列の中で date 以前の最新値（無ければ null） */
export function valueAt(series: { date: string; value: number }[], dateKey: string): number | null {
  let hit: number | null = null;
  for (const p of series) {
    if (p.date <= dateKey) hit = p.value;
    else break;
  }
  return hit;
}

// ---------- 取得 ----------
export interface KpiPoint {
  date: string; // YYYY-MM-DD（JST）
  value: number;
  note: string | null;
}

export interface KpiSummary extends KpiDef {
  latest: KpiPoint | null;
  judgment: Judgment;
  /** 直近30日（昇順） */
  series: KpiPoint[];
  /** 前回値との差（前回が無ければ null） */
  delta: number | null;
  linkedOpen: number;
}

function toPoint(v: { date: Date; value: number; note: string | null }): KpiPoint {
  return { date: jstDateKey(v.date), value: v.value, note: v.note };
}

function daysAgo(n: number, now: Date): Date {
  return new Date(now.getTime() - n * 86_400_000);
}

export async function listKpis(now = new Date()): Promise<KpiSummary[]> {
  await ensureKpiDefaults();
  const [kpis, values, linked] = await Promise.all([
    prisma.kpi.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
    prisma.kpiValue.findMany({ where: { demo: false }, orderBy: { date: 'asc' } }),
    prisma.task.findMany({ where: { kpiCode: { not: null }, status: { not: 'done' } }, select: { kpiCode: true } }),
  ]);
  const since30 = jstDateKey(daysAgo(30, now));
  const linkedCount = new Map<string, number>();
  for (const l of linked) linkedCount.set(l.kpiCode as string, (linkedCount.get(l.kpiCode as string) ?? 0) + 1);
  const order = new Map(KPI_DEFAULTS.map((d, i) => [d.code, i]));
  return kpis
    .map((k) => {
      const all = values.filter((v) => v.kpiCode === k.code).map(toPoint);
      const latest = all.length ? all[all.length - 1] : null;
      const prev = all.length > 1 ? all[all.length - 2] : null;
      const def: KpiDef = {
        code: k.code,
        name: k.name,
        unit: k.unit,
        direction: k.direction === 'down' ? 'down' : 'up',
        targetValue: k.targetValue,
        warnThreshold: k.warnThreshold,
        dangerThreshold: k.dangerThreshold,
        source: k.source,
        teamCode: k.teamCode,
        ownerUserId: k.ownerUserId,
        note: k.note,
        active: k.active,
      };
      return {
        ...def,
        latest,
        judgment: judgeKpi(def, latest?.value ?? null),
        series: all.filter((p) => p.date >= since30),
        delta: latest && prev ? latest.value - prev.value : null,
        linkedOpen: linkedCount.get(k.code) ?? 0,
      };
    })
    .sort((a, b) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99) || a.code.localeCompare(b.code));
}

export interface KpiLinkedTask {
  task: Task2Item;
  /** タスク作成時点の KPI 値（作成日以前の最新値） */
  before: number | null;
  /** 最新値 */
  after: number | null;
  delta: number | null;
}

export interface KpiDetail extends KpiSummary {
  /** 直近90日（昇順） */
  series90: KpiPoint[];
  /** 全期間の件数 */
  valueCount: number;
  tasks: KpiLinkedTask[];
}

export async function getKpi(code: string, now = new Date()): Promise<KpiDetail | null> {
  const list = await listKpis(now);
  const summary = list.find((k) => k.code === code);
  if (!summary) return null;
  const [values, tasksRes] = await Promise.all([
    prisma.kpiValue.findMany({ where: { kpiCode: code, demo: false }, orderBy: { date: 'asc' } }),
    listTasks2(),
  ]);
  const all = values.map(toPoint);
  const since90 = jstDateKey(daysAgo(90, now));
  const latest = summary.latest?.value ?? null;
  const tasks: KpiLinkedTask[] = tasksRes.tasks
    .filter((t) => t.kpiCode === code)
    .sort((a, b) => (a.displayStatus === '完了' ? 1 : 0) - (b.displayStatus === '完了' ? 1 : 0) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    .map((t) => {
      const done = t.displayStatus === '完了';
      const before = done && t.createdAt ? valueAt(all, jstDateKey(new Date(t.createdAt))) : null;
      const after = done ? latest : null;
      return { task: t, before, after, delta: before != null && after != null ? after - before : null };
    });
  return { ...summary, series90: all.filter((p) => p.date >= since90), valueCount: all.length, tasks };
}
