// タスク2.0（PRO）のデータ層。
// 正は従来どおり lib/tasks.ts（Kintone(38) または ローカルDB）。PRO 固有の項目（進捗率・プロジェクト・KPI・保留理由・依頼元）は
// Kintone に無いため、ローカルの Task 行（Kintone 由来なら kintoneId で紐づく「影の行」）にだけ持つ。
// 状態「保留」は Kintone 側では「確認待ち」のまま、ローカルの holdReason が入っていれば画面上「保留」と表示する。
import { prisma } from '../prisma';
import { listTasks, updateTask, type TaskItem, type TaskListResult } from '../tasks';
import { kintoneApi, kintoneTaskAppId, kintoneTaskConfigured, type KintoneRecord } from '../kintone';
import { jstDateKey } from '../metrics/format';
import { TEAM_DEFS, teamByKintoneLabel, teamOfMember, type TeamDef } from './teams';

// ---------- 優先度（緊急/高/中/低 ⇄ P1〜P4） ----------
export const PRIORITY_LEVELS = { P1: '緊急', P2: '高', P3: '中', P4: '低' } as const;
export type PriorityCode = keyof typeof PRIORITY_LEVELS;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[PriorityCode];

export function priorityLevel(code: string): PriorityLevel | null {
  return (PRIORITY_LEVELS as Record<string, PriorityLevel>)[code] ?? null;
}

export function priorityCode(level: string): PriorityCode | null {
  const hit = (Object.keys(PRIORITY_LEVELS) as PriorityCode[]).find((k) => PRIORITY_LEVELS[k] === level);
  return hit ?? null;
}

/** 表示用「P1 緊急」。未知のコードはそのまま */
export function priorityLabel(code: string): string {
  const lv = priorityLevel(code);
  return lv ? `${code} ${lv}` : code || '—';
}

// ---------- 状態（保留を追加） ----------
export const STATUSES2 = ['未着手', '進行中', '確認待ち', '保留', '完了'] as const;
export type Status2 = (typeof STATUSES2)[number];

/** 確認待ち滞留とみなす日数（この日数を超えて動きが無い確認待ち） */
export const WAITING_STALE_DAYS = 3;

export interface Task2Item extends TaskItem {
  /** Kintone/ローカルの状態に「保留」を重ねた表示状態 */
  displayStatus: Status2;
  progress: number; // 0-100
  projectCode: string | null;
  kpiCode: string | null;
  holdReason: string | null;
  requestedBy: string | null; // 依頼元ユーザー名
  lastActivityAt: string | null; // ISO（PROでの最終操作。無ければ updatedAt を使う）
  createdAt: string | null; // ISO（ローカル行の作成日時。KPI前後比較の起点）
  teamCode: string | null; // TEAM_DEFS の code
  teamName: string; // 表示名（対応表に無ければ Kintone の表記）
  priorityLevel: PriorityLevel | null;
}

export interface Task2ListResult extends Omit<TaskListResult, 'tasks'> {
  tasks: Task2Item[];
}

export function displayStatusOf(status: TaskItem['status'], holdReason: string | null | undefined): Status2 {
  if (status !== '完了' && holdReason && holdReason.trim()) return '保留';
  return status;
}

/** タスクが属する部署（Kintone のチーム表記 → 対応表。無ければ担当者の所属） */
export function teamOfTask(t: Pick<TaskItem, 'team' | 'assignee'>): TeamDef | undefined {
  return (t.team ? teamByKintoneLabel(t.team) : undefined) ?? (t.assignee ? teamOfMember(t.assignee) : undefined);
}

type ShadowRow = {
  id: string;
  kintoneId: string | null;
  progress: number;
  projectCode: string | null;
  kpiCode: string | null;
  holdReason: string | null;
  requestedByUserId: string | null;
  lastActivityAt: Date | null;
  createdAt: Date;
};

const SHADOW_SELECT = {
  id: true,
  kintoneId: true,
  progress: true,
  projectCode: true,
  kpiCode: true,
  holdReason: true,
  requestedByUserId: true,
  lastActivityAt: true,
  createdAt: true,
} as const;

export function mergeTask(t: TaskItem, shadow: ShadowRow | undefined, userNames: Map<string, string>): Task2Item {
  const team = teamOfTask(t);
  return {
    ...t,
    displayStatus: displayStatusOf(t.status, shadow?.holdReason),
    progress: Math.max(0, Math.min(100, shadow?.progress ?? 0)),
    projectCode: shadow?.projectCode ?? null,
    kpiCode: shadow?.kpiCode ?? null,
    holdReason: shadow?.holdReason ?? null,
    requestedBy: shadow?.requestedByUserId ? (userNames.get(shadow.requestedByUserId) ?? null) : null,
    lastActivityAt: shadow?.lastActivityAt ? shadow.lastActivityAt.toISOString() : null,
    createdAt: shadow?.createdAt ? shadow.createdAt.toISOString() : null,
    teamCode: team?.code ?? null,
    teamName: team?.name ?? (t.team || '未設定'),
    priorityLevel: priorityLevel(t.priority),
  };
}

export async function listTasks2(): Promise<Task2ListResult> {
  const base = await listTasks();
  const rows = await prisma.task.findMany({ select: SHADOW_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byKintone = new Map(rows.filter((r) => r.kintoneId).map((r) => [r.kintoneId as string, r]));
  const userIds = [...new Set(rows.map((r) => r.requestedByUserId).filter((v): v is string => Boolean(v)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const tasks = base.tasks.map((t) => mergeTask(t, t.source === 'kintone' ? byKintone.get(t.id) : byId.get(t.id), userNames));
  return { ...base, tasks };
}

// ---------- 影の行（Kintone 由来タスクの PRO 項目置き場） ----------

function kstr(r: KintoneRecord, code: string): string {
  const v = r[code]?.value;
  return v == null ? '' : String(v);
}

async function fetchKintoneTask(id: string): Promise<{ title: string; team: string; assignee: string; status: string; memo: string; doneDef: string; priority: string; due: string }> {
  const res = await kintoneApi<{ record: KintoneRecord }>('GET', `/k/v1/record.json?app=${encodeURIComponent(kintoneTaskAppId())}&id=${encodeURIComponent(id)}`);
  const r = res.record ?? {};
  return {
    title: kstr(r, 'task_name'),
    team: kstr(r, 'team'),
    assignee: kstr(r, 'tantou'),
    status: kstr(r, 'status'),
    memo: kstr(r, 'memo'),
    doneDef: kstr(r, 'done_def'),
    priority: kstr(r, 'priority'),
    due: kstr(r, 'due'),
  };
}

export interface TaskRef {
  /** listTasks() が返す id（Kintone ならレコード番号、ローカルなら cuid） */
  id: string;
  source: 'kintone' | 'local';
  /** PRO 項目を持つローカル行の id */
  localId: string;
  status: TaskItem['status'];
  memo: string;
  title: string;
}

const LOCAL_STATUS_JA: Record<string, TaskItem['status']> = { todo: '未着手', doing: '進行中', waiting: '確認待ち', done: '完了' };

/**
 * id からタスクの所在を解決し、PRO 項目を保存するローカル行を必ず用意する。
 * ローカル行が無く Kintone 接続中なら、Kintone レコードを読んで kintoneId 付きの影の行を作る。
 */
export async function ensureShadowTask(id: string): Promise<TaskRef> {
  const local = await prisma.task.findUnique({ where: { id }, select: { id: true, status: true, memo: true, title: true, kintoneId: true } });
  if (local) {
    return { id, source: 'local', localId: local.id, status: LOCAL_STATUS_JA[local.status] ?? '未着手', memo: local.memo ?? '', title: local.title };
  }
  if (!kintoneTaskConfigured()) throw new Error('タスクが見つかりません');
  const k = await fetchKintoneTask(id);
  if (!k.title) throw new Error(`Kintone にレコード #${id} が見つかりません`);
  const shadow = await prisma.task.findUnique({ where: { kintoneId: id }, select: { id: true } });
  const localId =
    shadow?.id ??
    (
      await prisma.task.create({
        data: {
          kintoneId: id,
          title: k.title,
          team: k.team || null,
          assigneeName: k.assignee || null,
          doneDef: k.doneDef || null,
          kPriority: k.priority || null,
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(k.due) ? new Date(`${k.due}T00:00:00+09:00`) : null,
          status: ({ 未着手: 'todo', 進行中: 'doing', 確認待ち: 'waiting', 完了: 'done' } as Record<string, string>)[k.status] ?? 'todo',
          memo: k.memo || null,
        },
        select: { id: true },
      })
    ).id;
  const status = (['未着手', '進行中', '確認待ち', '完了'] as const).find((s) => s === k.status) ?? '未着手';
  return { id, source: 'kintone', localId, status, memo: k.memo, title: k.title };
}

export async function setProgress(id: string, progress: number): Promise<TaskRef> {
  const ref = await ensureShadowTask(id);
  await prisma.task.update({ where: { id: ref.localId }, data: { progress, lastActivityAt: new Date() } });
  return ref;
}

const HOLD_TAG = '【保留】';

/** 保留にする: ローカルに理由を保存し、状態は「確認待ち」に揃える（Kintone には備考に【保留】理由を書く） */
export async function holdTask(id: string, reason: string): Promise<TaskRef> {
  const ref = await ensureShadowTask(id);
  if (ref.status === '完了') throw new Error('完了したタスクは保留にできません');
  await prisma.task.update({ where: { id: ref.localId }, data: { holdReason: reason, lastActivityAt: new Date() } });
  if (ref.source === 'kintone') {
    const memo = [...ref.memo.split('\n').filter((l) => !l.startsWith(HOLD_TAG)), `${HOLD_TAG}${reason}`].join('\n').trim();
    await updateTask(id, { status: '確認待ち', memo });
  } else if (ref.status !== '確認待ち') {
    await updateTask(id, { status: '確認待ち' });
  }
  return ref;
}

/** 保留を解除: 理由を消し、状態は「進行中」に戻す */
export async function resumeTask(id: string): Promise<TaskRef> {
  const ref = await ensureShadowTask(id);
  await prisma.task.update({ where: { id: ref.localId }, data: { holdReason: null, lastActivityAt: new Date() } });
  if (ref.status !== '完了') {
    const memo = ref.source === 'kintone' ? ref.memo.split('\n').filter((l) => !l.startsWith(HOLD_TAG)).join('\n').trim() : undefined;
    await updateTask(id, { status: '進行中', ...(memo !== undefined ? { memo } : {}) });
  }
  return ref;
}

export async function linkProjectKpi(id: string, projectCode: string | null | undefined, kpiCode: string | null | undefined): Promise<TaskRef> {
  const ref = await ensureShadowTask(id);
  await prisma.task.update({
    where: { id: ref.localId },
    data: {
      ...(projectCode !== undefined ? { projectCode: projectCode || null } : {}),
      ...(kpiCode !== undefined ? { kpiCode: kpiCode || null } : {}),
      lastActivityAt: new Date(),
    },
  });
  return ref;
}

// ---------- ボトルネック分析（純関数） ----------

export interface LoadRow {
  key: string;
  label: string;
  open: number;
  overdue: number;
  waitingStale: number;
  held: number;
  /** 未完了タスクの中で最も新しい動きから何日経ったか（未完了が無ければ null） */
  lastActivityDays: number | null;
}

export type StuckReason = '期限超過' | '確認待ち滞留' | '保留';

export interface StuckItem {
  task: Task2Item;
  reasons: StuckReason[];
  /** 止まっている日数（複数理由なら最大） */
  days: number;
}

export interface Bottlenecks {
  today: string;
  byAssignee: LoadRow[];
  byTeam: LoadRow[];
  stuck: StuckItem[];
}

function daysBetweenKeys(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** 最終の動き（PRO操作 or 更新日時）から経過した日数。日時が無ければ null */
export function activityDays(t: Pick<Task2Item, 'lastActivityAt' | 'updatedAt'>, now: Date): number | null {
  const iso = t.lastActivityAt ?? t.updatedAt;
  if (!iso) return null;
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function classifyStuck(t: Task2Item, now: Date): StuckItem | null {
  if (t.displayStatus === '完了') return null;
  const today = jstDateKey(now);
  const reasons: StuckReason[] = [];
  let days = 0;
  if (t.due && t.due < today) {
    reasons.push('期限超過');
    days = Math.max(days, daysBetweenKeys(t.due, today));
  }
  const act = activityDays(t, now);
  if (t.displayStatus === '確認待ち' && act != null && act > WAITING_STALE_DAYS) {
    reasons.push('確認待ち滞留');
    days = Math.max(days, act);
  }
  if (t.displayStatus === '保留') {
    reasons.push('保留');
    days = Math.max(days, act ?? 0);
  }
  return reasons.length ? { task: t, reasons, days } : null;
}

function buildLoad(tasks: Task2Item[], keyOf: (t: Task2Item) => { key: string; label: string }, now: Date): LoadRow[] {
  const rows = new Map<string, LoadRow & { minAct: number | null }>();
  for (const t of tasks) {
    if (t.displayStatus === '完了') continue;
    const { key, label } = keyOf(t);
    let row = rows.get(key);
    if (!row) {
      row = { key, label, open: 0, overdue: 0, waitingStale: 0, held: 0, lastActivityDays: null, minAct: null };
      rows.set(key, row);
    }
    row.open++;
    const s = classifyStuck(t, now);
    if (s) {
      if (s.reasons.includes('期限超過')) row.overdue++;
      if (s.reasons.includes('確認待ち滞留')) row.waitingStale++;
      if (s.reasons.includes('保留')) row.held++;
    }
    const act = activityDays(t, now);
    if (act != null) row.minAct = row.minAct == null ? act : Math.min(row.minAct, act);
  }
  return [...rows.values()]
    .map(({ minAct, ...r }) => ({ ...r, lastActivityDays: minAct }))
    .sort((a, b) => b.overdue + b.waitingStale + b.held - (a.overdue + a.waitingStale + a.held) || b.open - a.open || a.label.localeCompare(b.label, 'ja'));
}

export function computeBottlenecks(tasks: Task2Item[], now = new Date()): Bottlenecks {
  const stuck = tasks
    .map((t) => classifyStuck(t, now))
    .filter((s): s is StuckItem => s != null)
    .sort((a, b) => b.days - a.days || a.task.priority.localeCompare(b.task.priority));
  const teamOrder = new Map(TEAM_DEFS.map((t) => [t.code, t.sortOrder]));
  const byTeam = buildLoad(tasks, (t) => ({ key: t.teamCode ?? `label:${t.team || '未設定'}`, label: t.teamName }), now).sort(
    (a, b) => (teamOrder.get(a.key) ?? 99) - (teamOrder.get(b.key) ?? 99),
  );
  return {
    today: jstDateKey(now),
    byAssignee: buildLoad(tasks, (t) => ({ key: t.assignee || '未割当', label: t.assignee || '未割当' }), now),
    byTeam,
    stuck,
  };
}

/** 部署×状態のマトリクス（行=部署、列=STATUSES2） */
export interface MatrixRow {
  key: string;
  label: string;
  counts: Record<Status2, number>;
  total: number;
}

export function statusMatrix(tasks: Task2Item[]): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  const empty = (): Record<Status2, number> => ({ 未着手: 0, 進行中: 0, 確認待ち: 0, 保留: 0, 完了: 0 });
  for (const t of tasks) {
    const key = t.teamCode ?? `label:${t.team || '未設定'}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, label: t.teamName, counts: empty(), total: 0 };
      rows.set(key, row);
    }
    row.counts[t.displayStatus]++;
    row.total++;
  }
  const order = new Map(TEAM_DEFS.map((t) => [t.code, t.sortOrder]));
  return [...rows.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99) || a.label.localeCompare(b.label, 'ja'));
}

// ---------- プロジェクト ----------

export interface ProjectItem {
  id: string;
  code: string;
  name: string;
  teamCode: string | null;
  teamName: string;
  ownerUserId: string | null;
  ownerName: string | null;
  status: string;
  goal: string | null;
  kpiCode: string | null;
  startDate: string | null;
  dueDate: string | null;
  /** 紐づくタスクの進捗率平均（完了は100扱い）。タスクが無ければ null */
  progress: number | null;
  taskCount: number;
  openCount: number;
  overdue: number;
}

export const PROJECT_STATUS_JA: Record<string, string> = { planned: '計画中', active: '進行中', hold: '保留', done: '完了', archived: '終了' };

/** タスク群からプロジェクト進捗（完了タスクは100として平均）。空なら null */
export function projectProgress(tasks: Pick<Task2Item, 'progress' | 'displayStatus'>[]): number | null {
  if (!tasks.length) return null;
  const sum = tasks.reduce((a, t) => a + (t.displayStatus === '完了' ? 100 : t.progress), 0);
  return Math.round(sum / tasks.length);
}

/** プロジェクト名からコードを作る。英数字があればスラッグ、無ければ prj-YYYYMMDD（重複は呼び出し側で連番） */
export function projectCodeFromName(name: string, now = new Date()): string {
  const slug = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (slug.length >= 3) return slug;
  return `prj-${jstDateKey(now).replace(/-/g, '')}`;
}

export async function listProjects(tasks?: Task2Item[]): Promise<ProjectItem[]> {
  const [rows, all] = await Promise.all([prisma.project.findMany({ orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }] }), tasks ? Promise.resolve(tasks) : listTasks2().then((r) => r.tasks)]);
  const ownerIds = [...new Set(rows.map((r) => r.ownerUserId).filter((v): v is string => Boolean(v)))];
  const users = ownerIds.length ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  const today = jstDateKey(new Date());
  return rows.map((p) => {
    const ts = all.filter((t) => t.projectCode === p.code);
    const open = ts.filter((t) => t.displayStatus !== '完了');
    const team = p.teamCode ? TEAM_DEFS.find((d) => d.code === p.teamCode) : undefined;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      teamCode: p.teamCode,
      teamName: team?.name ?? (p.teamCode ?? '未設定'),
      ownerUserId: p.ownerUserId,
      ownerName: p.ownerUserId ? (names.get(p.ownerUserId) ?? null) : null,
      status: p.status,
      goal: p.goal,
      kpiCode: p.kpiCode,
      startDate: p.startDate ? jstDateKey(p.startDate) : null,
      dueDate: p.dueDate ? jstDateKey(p.dueDate) : null,
      progress: projectProgress(ts),
      taskCount: ts.length,
      openCount: open.length,
      overdue: open.filter((t) => t.due && t.due < today).length,
    };
  });
}
