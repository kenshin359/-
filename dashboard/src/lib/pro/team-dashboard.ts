// 部署別ダッシュボード（PRO ②）のデータ層。会社 → 部署 → 担当者。
// 部署定義は src/lib/pro/teams.ts の TEAM_DEFS（DB の Team テーブルに行があれば名前・責任者を上書き）。
// タスクは lib/tasks.listTasks()（Kintone 正・未接続時はローカル）を部署の Kintone チーム表記で絞る。
// KPI・報告・メモは Prisma（Kpi/KpiValue・Report・Note）。無いものは「未設定」と返し、推測で埋めない。
import { prisma } from '../prisma';
import { listTasks, type TaskItem, type TaskOptions } from '../tasks';
import { PRIORITIES } from '../tasks-constants';
import { jstDateKey } from '../metrics/format';
import { TEAM_DEFS, teamByCode, type TeamDef } from './teams';
import { addDays } from './format';

/** 確認待ちの滞留とみなす日数（docs/pro-plan.md ⑧「🟡確認待ち」= 3日超で滞留） */
export const WAITING_STALE_DAYS = 3;
/** 「今週」= 今日から7日以内 */
export const WEEK_AHEAD_DAYS = 7;

/** 担当者の負荷判定（STANDARD タスク管理 TaskBoard.columnLoad と同じ境界: 8件以上=多め・3件以下=余裕） */
export const LOAD_HEAVY_OPEN = 8;
export const LOAD_LIGHT_OPEN = 3;

export type Judgment = 'ok' | 'warn' | 'danger' | 'none';

export interface ReportBrief {
  id: string;
  type: string;
  title: string;
  authorName: string | null;
  status: string;
  periodFrom: string; // ISO
  periodTo: string; // ISO
  createdAt: string; // ISO
}

export interface TeamSummary {
  code: string;
  name: string;
  parentCode: string | null;
  parentName: string | null;
  leader: string | null;
  members: string[];
  kintoneLabels: string[];
  open: number;
  overdue: number;
  waitingStale: number;
  dueThisWeek: number;
  latestReport: ReportBrief | null;
}

export interface TeamsSummaryResult {
  today: string;
  teams: TeamSummary[];
  source: 'kintone' | 'local';
  notice: string | null;
}

export interface KpiCard {
  code: string;
  name: string;
  unit: string;
  direction: string;
  targetValue: number | null;
  latest: { date: string; value: number } | null;
  judgment: Judgment;
  judgmentReason: string;
}

export interface MemberLoad {
  name: string;
  userId: string | null; // 同じ kintoneName の User がいれば /pro/people/[id] へ
  open: number;
  overdue: number;
  waiting: number;
  nextDue: string | null;
  load: { label: string; tone: Judgment; reason: string };
  tasks: TaskItem[]; // 未完了のみ（優先度→期限順）
}

export type ProblemKind = 'overdue' | 'waitingStale' | 'noAssignee';

export interface Problem {
  kind: ProblemKind;
  label: string;
  task: TaskItem;
  detail: string;
}

export interface TeamNote {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface TeamDashboard {
  today: string;
  code: string;
  name: string;
  parentName: string | null;
  leader: string | null;
  members: string[];
  kintoneLabels: string[];
  kpis: KpiCard[];
  summary: { open: number; overdue: number; waiting: number; waitingStale: number; dueThisWeek: number; noAssignee: number };
  problems: Problem[];
  memberLoads: MemberLoad[];
  reports: ReportBrief[];
  notes: TeamNote[];
  options: TaskOptions;
  source: 'kintone' | 'local';
  notice: string | null;
}

const rank = (t: TaskItem) => {
  const i = PRIORITIES.indexOf(t.priority as (typeof PRIORITIES)[number]);
  return i < 0 ? PRIORITIES.length : i;
};
const byPriorityThenDue = (a: TaskItem, b: TaskItem) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999');

function isNoAssignee(t: TaskItem): boolean {
  const a = t.assignee.replace(/\s/g, '');
  return a === '' || a === '未割当';
}

/** 確認待ちのまま WAITING_STALE_DAYS 日を超えて更新が無い */
export function isWaitingStale(t: TaskItem, now: Date): boolean {
  if (t.status !== '確認待ち') return false;
  if (!t.updatedAt) return false;
  const ts = new Date(t.updatedAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now.getTime() - ts > WAITING_STALE_DAYS * 86_400_000;
}

export function tasksOfTeam(tasks: TaskItem[], def: TeamDef): TaskItem[] {
  if (def.kintoneLabels.length === 0) return [];
  return tasks.filter((t) => def.kintoneLabels.includes(t.team));
}

export function teamCounts(tasks: TaskItem[], today: string, now: Date) {
  const open = tasks.filter((t) => t.status !== '完了');
  const weekEnd = addDays(today, WEEK_AHEAD_DAYS - 1);
  return {
    open: open.length,
    overdue: open.filter((t) => t.due && t.due < today).length,
    waiting: open.filter((t) => t.status === '確認待ち').length,
    waitingStale: open.filter((t) => isWaitingStale(t, now)).length,
    dueThisWeek: open.filter((t) => t.due && t.due >= today && t.due <= weekEnd).length,
    noAssignee: open.filter(isNoAssignee).length,
  };
}

/** 担当者の負荷ラベル（TaskBoard.columnLoad と同じ判定） */
export function memberLoadLabel(open: number, overdue: number): MemberLoad['load'] {
  if (overdue > 0) return { label: `期限超過 ${overdue}`, tone: 'danger', reason: '期限を過ぎた未完了タスクがあります' };
  if (open >= LOAD_HEAVY_OPEN) return { label: '多め', tone: 'warn', reason: `未完了が${LOAD_HEAVY_OPEN}件以上あります。P1から順に` };
  if (open <= LOAD_LIGHT_OPEN) return { label: '余裕あり', tone: 'ok', reason: `未完了が${LOAD_LIGHT_OPEN}件以下です` };
  return { label: '通常', tone: 'none', reason: `未完了が${LOAD_LIGHT_OPEN + 1}〜${LOAD_HEAVY_OPEN - 1}件です` };
}

/** KPI の判定。目標が無ければ none（「未設定」表示）。数値の推測はしない */
export function judgeKpi(k: { direction: string; targetValue: number | null; warnThreshold: number | null; dangerThreshold: number | null }, value: number | null): { judgment: Judgment; reason: string } {
  if (value == null) return { judgment: 'none', reason: '実績値なし' };
  if (k.targetValue == null) return { judgment: 'none', reason: '目標未設定' };
  const up = k.direction !== 'down';
  const meets = up ? value >= k.targetValue : value <= k.targetValue;
  if (meets) return { judgment: 'ok', reason: '目標達成' };
  if (k.warnThreshold != null) {
    const withinWarn = up ? value >= k.warnThreshold : value <= k.warnThreshold;
    if (withinWarn) return { judgment: 'warn', reason: '目標未達（注意ライン内）' };
  }
  if (k.dangerThreshold != null) {
    const withinDanger = up ? value >= k.dangerThreshold : value <= k.dangerThreshold;
    if (withinDanger) return { judgment: 'warn', reason: '目標未達（危険ライン手前）' };
  }
  return { judgment: 'danger', reason: '目標未達' };
}

type ReportRow = {
  id: string;
  type: string;
  title: string;
  authorName: string | null;
  status: string;
  periodFrom: Date;
  periodTo: Date;
  createdAt: Date;
};
const REPORT_SELECT = { id: true, type: true, title: true, authorName: true, status: true, periodFrom: true, periodTo: true, createdAt: true } as const;
const toReportBrief = (r: ReportRow): ReportBrief => ({
  id: r.id,
  type: r.type,
  title: r.title,
  authorName: r.authorName,
  status: r.status,
  periodFrom: r.periodFrom.toISOString(),
  periodTo: r.periodTo.toISOString(),
  createdAt: r.createdAt.toISOString(),
});

/** DB の Team 行で名前・責任者を上書きした部署定義（無ければ TEAM_DEFS のまま） */
async function resolvedDefs(): Promise<TeamDef[]> {
  const rows = await prisma.team.findMany().catch(() => []);
  if (rows.length === 0) return TEAM_DEFS;
  const leaderIds = rows.map((r) => r.leaderUserId).filter((v): v is string => !!v);
  const users = leaderIds.length
    ? await prisma.user.findMany({ where: { id: { in: leaderIds } }, select: { id: true, name: true, kintoneName: true } })
    : [];
  const leaderName = new Map(users.map((u) => [u.id, u.kintoneName || u.name]));
  return TEAM_DEFS.filter((d) => rows.find((r) => r.code === d.code)?.active !== false).map((d) => {
    const r = rows.find((x) => x.code === d.code);
    if (!r) return d;
    const labels = r.kintoneLabel && !d.kintoneLabels.includes(r.kintoneLabel) ? [...d.kintoneLabels, r.kintoneLabel] : d.kintoneLabels;
    return { ...d, name: r.name || d.name, leader: (r.leaderUserId && leaderName.get(r.leaderUserId)) || d.leader, kintoneLabels: labels };
  });
}

export async function listTeamsSummary(now = new Date()): Promise<TeamsSummaryResult> {
  const today = jstDateKey(now);
  const [data, defs, reports] = await Promise.all([
    listTasks(),
    resolvedDefs(),
    prisma.report.findMany({ where: { teamCode: { not: null } }, orderBy: { createdAt: 'desc' }, select: { ...REPORT_SELECT, teamCode: true } }),
  ]);
  const latestByTeam = new Map<string, ReportBrief>();
  for (const r of reports) if (r.teamCode && !latestByTeam.has(r.teamCode)) latestByTeam.set(r.teamCode, toReportBrief(r));
  const nameOf = new Map(defs.map((d) => [d.code, d.name]));

  const teams: TeamSummary[] = defs
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((d) => {
      const c = teamCounts(tasksOfTeam(data.tasks, d), today, now);
      return {
        code: d.code,
        name: d.name,
        parentCode: d.parentCode,
        parentName: d.parentCode ? (nameOf.get(d.parentCode) ?? null) : null,
        leader: d.leader,
        members: d.members,
        kintoneLabels: d.kintoneLabels,
        open: c.open,
        overdue: c.overdue,
        waitingStale: c.waitingStale,
        dueThisWeek: c.dueThisWeek,
        latestReport: latestByTeam.get(d.code) ?? null,
      };
    });
  return { today, teams, source: data.source, notice: data.notice };
}

export async function getTeamDashboard(code: string, now = new Date()): Promise<TeamDashboard | null> {
  if (!teamByCode(code)) return null;
  const today = jstDateKey(now);
  const [data, defs, kpiRows, reportRows, noteRows] = await Promise.all([
    listTasks(),
    resolvedDefs(),
    prisma.kpi.findMany({
      where: { teamCode: code, active: true },
      orderBy: { code: 'asc' },
      include: { values: { where: { demo: false }, orderBy: { date: 'desc' }, take: 1 } },
    }),
    prisma.report.findMany({ where: { teamCode: code }, orderBy: { createdAt: 'desc' }, take: 5, select: REPORT_SELECT }),
    prisma.note.findMany({ where: { entityType: 'team', entityId: code }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  const def = defs.find((d) => d.code === code);
  if (!def) return null; // DB で無効化された部署
  const parentName = def.parentCode ? (defs.find((d) => d.code === def.parentCode)?.name ?? null) : null;

  const teamTasks = tasksOfTeam(data.tasks, def);
  const open = teamTasks.filter((t) => t.status !== '完了');
  const summary = teamCounts(teamTasks, today, now);

  // 問題: 期限超過 → 確認待ち滞留 → 担当者未設定（同じタスクは一度だけ）
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const add = (kind: ProblemKind, label: string, t: TaskItem, detail: string) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    problems.push({ kind, label, task: t, detail });
  };
  for (const t of open.filter((t) => t.due && t.due < today).sort(byPriorityThenDue)) add('overdue', '期限超過', t, `期限 ${t.due}`);
  for (const t of open.filter((t) => isWaitingStale(t, now)).sort(byPriorityThenDue)) {
    const days = Math.floor((now.getTime() - new Date(t.updatedAt!).getTime()) / 86_400_000);
    add('waitingStale', '確認待ち滞留', t, `${days}日間 確認待ちのまま`);
  }
  for (const t of open.filter(isNoAssignee).sort(byPriorityThenDue)) add('noAssignee', '担当者未設定', t, '担当者を決めてください');

  // 担当者別: 定義上のメンバー ＋ 実際にタスクを持っている人
  const names = [...def.members];
  for (const t of open) {
    const n = isNoAssignee(t) ? '未割当' : t.assignee;
    if (!names.includes(n)) names.push(n);
  }
  const users = names.length
    ? await prisma.user.findMany({ where: { kintoneName: { in: names.filter((n) => n !== '未割当') } }, select: { id: true, kintoneName: true } })
    : [];
  const userIdOf = new Map(users.map((u) => [u.kintoneName!, u.id]));
  const memberLoads: MemberLoad[] = names.map((name) => {
    const list = open.filter((t) => (isNoAssignee(t) ? '未割当' : t.assignee) === name).sort(byPriorityThenDue);
    const overdue = list.filter((t) => t.due && t.due < today).length;
    const dues = list.map((t) => t.due).filter((d): d is string => !!d && d >= today).sort();
    return {
      name,
      userId: name === '未割当' ? null : (userIdOf.get(name) ?? null),
      open: list.length,
      overdue,
      waiting: list.filter((t) => t.status === '確認待ち').length,
      nextDue: dues[0] ?? null,
      load: memberLoadLabel(list.length, overdue),
      tasks: list,
    };
  });

  const kpis: KpiCard[] = kpiRows.map((k) => {
    const v = k.values[0];
    const j = judgeKpi(k, v ? v.value : null);
    return {
      code: k.code,
      name: k.name,
      unit: k.unit,
      direction: k.direction,
      targetValue: k.targetValue,
      latest: v ? { date: jstDateKey(v.date), value: v.value } : null,
      judgment: j.judgment,
      judgmentReason: j.reason,
    };
  });

  return {
    today,
    code: def.code,
    name: def.name,
    parentName,
    leader: def.leader,
    members: def.members,
    kintoneLabels: def.kintoneLabels,
    kpis,
    summary,
    problems,
    memberLoads,
    reports: reportRows.map(toReportBrief),
    notes: noteRows.map((n) => ({ id: n.id, body: n.body, authorName: n.authorName, createdAt: n.createdAt.toISOString() })),
    options: data.options,
    source: data.source,
    notice: data.notice,
  };
}

/** 一般社員が見られる部署（User.teamCode を優先、無ければ担当者名から推定） */
export function ownTeamCodeFor(actor: { teamCode: string | null; kintoneName: string | null }): string | null {
  if (actor.teamCode && teamByCode(actor.teamCode)) return actor.teamCode;
  if (actor.kintoneName) {
    const d = TEAM_DEFS.find((t) => t.members.includes(actor.kintoneName!));
    if (d) return d.code;
  }
  return null;
}
