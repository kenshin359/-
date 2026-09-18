// PRO ⑨ 社員・組織管理のデータ層。
// User（プロフィール）に、タスク管理（listTasks: Kintone or ローカル）から求めた「仕事の状態」と、
// 最新の報告・メモ・担当KPI を付けて返す。
//
// 方針（docs/pro-plan.md §5 ⑨）:
// - ランキングは作らない。成果（完了数など）で並べ替えない。並び順は「部署（TEAM_DEFS順→未設定）→氏名」固定。
// - 一般社員（staff）は自分と自チームのみ。判定はサーバー側（ここ）で行い、UIの出し分けだけに頼らない。
// - 機密（給与・人事評価など）の列が User に増えたら redactConfidential() をここで通す（APIレベルで落とす）。
import { z } from 'zod';
import { prisma } from '../prisma';
import { listTasks, type TaskItem } from '../tasks';
import { jstDateKey } from '../metrics/format';
import { LEVELS, LEVEL_JA, canSeeCompanyWide, isLevel, type Actor, type Level } from '../rbac';
import { TEAM_DEFS, teamByCode } from './teams';

export const UNASSIGNED_TEAM = '__none__';

// ---- 入力スキーマ（Server Action から使う。'use server' ファイルには async 関数以外を export できないためここに置く）----
const TEAM_CODES = TEAM_DEFS.map((t) => t.code);

/** 空文字は null に正規化して保存する */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}は${max}文字以内にしてください`)
    .transform((s) => (s === '' ? null : s));

export const ProfileInput = z.object({
  title: optionalText(60, '役職・担当業務'),
  kintoneName: optionalText(30, 'Kintone担当者名').refine((s) => s == null || !/[\s|]/.test(s), {
    message: 'Kintone担当者名に空白や「|」は使えません',
  }),
  skills: optionalText(300, 'スキル'),
  lineUserId: optionalText(64, 'LINE userId').refine((s) => s == null || /^U[0-9a-f]{32}$/.test(s), {
    message: 'LINE userId は「U」+32桁の英数字（小文字）です',
  }),
});
export type ProfileInputType = z.input<typeof ProfileInput>;

export const LevelTeamInput = z.object({
  level: z.enum(LEVELS, { message: '権限レベルを選んでください' }),
  teamCode: z
    .string()
    .trim()
    .transform((s) => (s === '' ? null : s))
    .refine((s) => s == null || TEAM_CODES.includes(s), { message: '所属部署が不正です' }),
});
export type LevelTeamInputType = z.input<typeof LevelTeamInput>;

export interface WorkStatus {
  /** 未完了（完了以外） */
  open: number;
  /** 未完了のうち P1 */
  p1Open: number;
  /** 期限超過（未完了かつ期限 < 今日） */
  overdue: number;
  /** 確認待ち */
  waiting: number;
  /** 直近30日に完了（更新日時ベース） */
  done30d: number;
  /** 未完了タスクの最も近い期限（YYYY-MM-DD） */
  nextDue: string | null;
  /** 本日期限 */
  dueToday: number;
}

export interface ReportBrief {
  id: string;
  type: string;
  title: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  createdAt: string;
}

export interface NoteBrief {
  id: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export interface PersonSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  level: Level;
  levelJa: string;
  teamCode: string | null;
  teamName: string;
  title: string | null;
  kintoneName: string | null;
  skills: string[];
  work: WorkStatus;
  latestReport: ReportBrief | null;
  isSelf: boolean;
}

export interface KpiBrief {
  code: string;
  name: string;
  unit: string;
  direction: string;
  targetValue: number | null;
  latestValue: number | null;
  latestDate: string | null;
  teamCode: string | null;
}

export interface PersonDetail extends PersonSummary {
  lineUserId: string | null;
  createdAt: string;
  /** 未完了タスク（P1→期限順） */
  openTasks: TaskItem[];
  /** 直近30日の完了タスク（新しい順） */
  doneTasks: TaskItem[];
  /** 期限超過（未完了） */
  overdueTasks: TaskItem[];
  kpis: KpiBrief[];
  reports: ReportBrief[];
  notes: NoteBrief[];
  /** 本人 or 管理者 */
  canEdit: boolean;
  /** 権限・所属を変えられるか（管理者のみ） */
  canAssign: boolean;
  /** Kintone担当者名の候補（編集フォームの datalist 用） */
  memberOptions: string[];
  taskSource: 'kintone' | 'local';
  taskNotice: string | null;
  today: string;
}

export interface PeopleListResult {
  people: PersonSummary[];
  today: string;
  taskSource: 'kintone' | 'local';
  taskNotice: string | null;
  /** 全社を見られるか（false のときは自チームのみに絞っている） */
  companyWide: boolean;
  /** 絞り込み対象のチーム（自チームのみのとき） */
  scopedTeamCode: string | null;
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  level: string;
  teamCode: string | null;
  title: string | null;
  kintoneName: string | null;
  skills: string | null;
};

function normalize(s: string): string {
  return s.replace(/\s/g, '');
}

/**
 * タスクの担当者名がこのユーザーのものか。
 * kintoneName が設定されていればその完全一致（空白除去）。未設定なら氏名の前方一致で代用（TaskBoard と同じ緩さ）。
 */
export function taskBelongsTo(assignee: string, user: { kintoneName: string | null; name: string }): boolean {
  const a = normalize(assignee);
  if (!a) return false;
  if (user.kintoneName) return a === normalize(user.kintoneName);
  const n = normalize(user.name);
  if (!n) return false;
  return n.startsWith(a) || a.startsWith(n);
}

export function computeWorkStatus(tasks: TaskItem[], now = new Date()): WorkStatus {
  const today = jstDateKey(now);
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const w: WorkStatus = { open: 0, p1Open: 0, overdue: 0, waiting: 0, done30d: 0, nextDue: null, dueToday: 0 };
  for (const t of tasks) {
    if (t.status === '完了') {
      if (t.updatedAt && new Date(t.updatedAt).getTime() >= since) w.done30d++;
      continue;
    }
    w.open++;
    if (t.priority === 'P1') w.p1Open++;
    if (t.status === '確認待ち') w.waiting++;
    if (t.due) {
      if (t.due < today) w.overdue++;
      else if (t.due === today) w.dueToday++;
      if (!w.nextDue || t.due < w.nextDue) w.nextDue = t.due;
    }
  }
  return w;
}

const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

/** 未完了タスクの並び: P1→P4、同じ優先度なら期限が近い順（期限なしは最後） */
export function sortOpenTasks(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => {
    const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (p !== 0) return p;
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
    if (a.due) return -1;
    if (b.due) return 1;
    return 0;
  });
}

function splitSkills(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/[,、，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function teamOrder(code: string | null): number {
  if (!code) return Number.MAX_SAFE_INTEGER;
  const t = teamByCode(code);
  return t ? t.sortOrder : Number.MAX_SAFE_INTEGER - 1;
}

function teamNameOf(code: string | null): string {
  if (!code) return '未設定';
  return teamByCode(code)?.name ?? code;
}

function levelOf(u: { role: string; level: string }): Level {
  // currentActor() と同じ扱い: admin は経営者相当
  if (u.role === 'admin') return 'ceo';
  return isLevel(u.level) ? u.level : 'staff';
}

function toSummary(u: UserRow, tasks: TaskItem[], latestReport: ReportBrief | null, actor: Actor, now: Date): PersonSummary {
  const level = levelOf(u);
  const summary: PersonSummary = {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    level,
    levelJa: LEVEL_JA[level],
    teamCode: u.teamCode,
    teamName: teamNameOf(u.teamCode),
    title: u.title,
    kintoneName: u.kintoneName,
    skills: splitSkills(u.skills),
    work: computeWorkStatus(tasks, now),
    latestReport,
    isSelf: u.id === actor.id,
  };
  // 機密（給与・人事評価など）の列が User に増えたら、ここで
  //   return redactConfidential(summary, actor.level, ['salary', 'evaluation']);
  // のようにAPIレベルで落とす（管理職未満には null で返す）。現時点で該当列は無い。
  return summary;
}

function reportBrief(r: {
  id: string;
  type: string;
  title: string;
  status: string;
  periodFrom: Date;
  periodTo: Date;
  createdAt: Date;
}): ReportBrief {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    status: r.status,
    periodFrom: jstDateKey(r.periodFrom),
    periodTo: jstDateKey(r.periodTo),
    createdAt: r.createdAt.toISOString(),
  };
}

function noteBrief(n: { id: string; body: string; entityType: string | null; entityId: string | null; createdAt: Date }): NoteBrief {
  return { id: n.id, body: n.body, entityType: n.entityType, entityId: n.entityId, createdAt: n.createdAt.toISOString() };
}

/** 一般社員が見てよい相手か: 本人 or 同じチーム（チーム未設定の一般社員は本人のみ） */
export function canViewPerson(actor: Actor, target: { id: string; teamCode: string | null }): boolean {
  if (target.id === actor.id) return true;
  if (canSeeCompanyWide(actor.level)) return true;
  return !!actor.teamCode && actor.teamCode === target.teamCode;
}

export function canEditProfile(actor: Actor, targetId: string): boolean {
  return actor.role === 'admin' || actor.id === targetId;
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  level: true,
  teamCode: true,
  title: true,
  kintoneName: true,
  skills: true,
} as const;

/**
 * 社員一覧。並び順は「部署（TEAM_DEFS順→未設定）→氏名」のみ。
 * 完了数・期限超過などの成果でソートしない（ランキングを作らない方針）。
 */
export async function listPeople(actor: Actor, now = new Date()): Promise<PeopleListResult> {
  const companyWide = canSeeCompanyWide(actor.level);
  const where = companyWide
    ? {}
    : actor.teamCode
      ? { OR: [{ id: actor.id }, { teamCode: actor.teamCode }] }
      : { id: actor.id };

  const [users, taskRes] = await Promise.all([prisma.user.findMany({ where, select: USER_SELECT }), listTasks()]);
  const ids = users.map((u) => u.id);

  // 各ユーザーの最新報告を1件ずつ（人数分クエリするより、対象者の報告を新しい順に取って先頭を採る）
  const reports = ids.length
    ? await prisma.report.findMany({
        where: { authorUserId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, title: true, status: true, periodFrom: true, periodTo: true, createdAt: true, authorUserId: true },
      })
    : [];
  const latestByUser = new Map<string, ReportBrief>();
  for (const r of reports) {
    if (r.authorUserId && !latestByUser.has(r.authorUserId)) latestByUser.set(r.authorUserId, reportBrief(r));
  }

  const people = users
    .map((u) =>
      toSummary(
        u,
        taskRes.tasks.filter((t) => taskBelongsTo(t.assignee, u)),
        latestByUser.get(u.id) ?? null,
        actor,
        now,
      ),
    )
    .sort((a, b) => {
      const t = teamOrder(a.teamCode) - teamOrder(b.teamCode);
      if (t !== 0) return t;
      return a.name.localeCompare(b.name, 'ja');
    });

  return {
    people,
    today: jstDateKey(now),
    taskSource: taskRes.source,
    taskNotice: taskRes.notice,
    companyWide,
    scopedTeamCode: companyWide ? null : actor.teamCode,
  };
}

/** 一人分の詳細。閲覧権限が無い・存在しない場合は null（呼び出し側で「見つかりません」表示） */
export async function getPerson(id: string, actor: Actor, now = new Date()): Promise<PersonDetail | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: { ...USER_SELECT, lineUserId: true, createdAt: true },
  });
  if (!u) return null;
  if (!canViewPerson(actor, u)) return null;

  const [taskRes, reports, notes, kpis] = await Promise.all([
    listTasks(),
    prisma.report.findMany({
      where: { authorUserId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, type: true, title: true, status: true, periodFrom: true, periodTo: true, createdAt: true },
    }),
    prisma.note.findMany({
      where: { authorUserId: id },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, body: true, entityType: true, entityId: true, createdAt: true },
    }),
    prisma.kpi.findMany({
      where: { ownerUserId: id, active: true },
      orderBy: { code: 'asc' },
      include: { values: { orderBy: { date: 'desc' }, take: 1, where: { demo: false } } },
    }),
  ]);

  const mine = taskRes.tasks.filter((t) => taskBelongsTo(t.assignee, u));
  const today = jstDateKey(now);
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const open = sortOpenTasks(mine.filter((t) => t.status !== '完了'));
  const done = mine
    .filter((t) => t.status === '完了' && t.updatedAt && new Date(t.updatedAt).getTime() >= since)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const overdue = open.filter((t) => t.due && t.due < today);

  const summary = toSummary(u, mine, reports[0] ? reportBrief(reports[0]) : null, actor, now);
  const canEdit = canEditProfile(actor, id);
  return {
    ...summary,
    // LINE userId は本人・管理者以外には返さない（個人識別子）
    lineUserId: canEdit ? u.lineUserId : null,
    createdAt: u.createdAt.toISOString(),
    openTasks: open,
    doneTasks: done,
    overdueTasks: overdue,
    kpis: kpis.map((k) => ({
      code: k.code,
      name: k.name,
      unit: k.unit,
      direction: k.direction,
      targetValue: k.targetValue,
      latestValue: k.values[0]?.value ?? null,
      latestDate: k.values[0] ? jstDateKey(k.values[0].date) : null,
      teamCode: k.teamCode,
    })),
    reports: reports.map(reportBrief),
    notes: notes.map(noteBrief),
    canEdit,
    canAssign: actor.role === 'admin',
    memberOptions: taskRes.options.members,
    taskSource: taskRes.source,
    taskNotice: taskRes.notice,
    today,
  };
}

/** 画面のセレクト用: チーム一覧（TEAM_DEFS順） */
export function teamOptions(): { code: string; name: string }[] {
  return [...TEAM_DEFS].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => ({ code: t.code, name: t.name }));
}
