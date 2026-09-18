// タスク管理のデータ層。
// 正はKintone「タスク管理（チーム進捗）」(38)。接続設定があればKintoneを読み書きし、
// 無ければローカルDB（Prisma Task）で同じ項目を扱う（画面には「未接続」と明示する）。
// 項目・選択肢は daily-report-system/kintone/taskBoardSchema.js と同一。
import { z } from 'zod';
import { prisma } from './prisma';
import {
  addRecord,
  fetchAllRecords,
  fetchDropdownOptions,
  kintoneTaskAppId,
  kintoneTaskConfigured,
  updateRecord,
  KintoneError,
  type KintoneRecord,
} from './kintone';
import { jstDateKey } from './metrics/format';

export { TEAMS, MEMBERS, PRIORITIES, IMPACTS, STATUSES } from './tasks-constants';
export type { TaskStatus } from './tasks-constants';
import { TEAMS, MEMBERS, PRIORITIES, IMPACTS, STATUSES, type TaskStatus } from './tasks-constants';

export interface TaskItem {
  id: string;
  source: 'kintone' | 'local';
  team: string;
  assignee: string;
  title: string;
  doneDef: string;
  priority: string;
  impact: string;
  due: string | null; // YYYY-MM-DD（JST）
  status: TaskStatus;
  yanai: string;
  memo: string;
  updatedAt: string | null; // ISO
}

export interface TaskOptions {
  teams: string[];
  members: string[];
}

export interface TaskListResult {
  tasks: TaskItem[];
  options: TaskOptions;
  source: 'kintone' | 'local';
  /** Kintone未接続・エラー時の説明（画面にそのまま出す） */
  notice: string | null;
  appId: string;
}

// 柳井ルール: 期限と「完了の定義（数字）」のないタスクは登録禁止
export const TaskInput = z.object({
  title: z.string().trim().min(1, 'タスク名を入力してください').max(120, 'タスク名は120文字以内'),
  team: z.string().trim().min(1, 'チームを選んでください'),
  assignee: z.string().trim().min(1, '担当者を選んでください'),
  doneDef: z
    .string()
    .trim()
    .min(1, '「完了の定義」を数字で書いてください（"報告した"は完了ではありません）')
    .max(200),
  priority: z.enum(PRIORITIES),
  impact: z.enum(IMPACTS),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '期限を入力してください'),
  status: z.enum(STATUSES).default('未着手'),
  yanai: z.string().trim().max(200).default(''),
  memo: z.string().trim().max(2000).default(''),
});
export type TaskInputType = z.infer<typeof TaskInput>;

function str(r: KintoneRecord, code: string): string {
  const v = r[code]?.value;
  return v == null ? '' : String(v);
}

function fromKintone(r: KintoneRecord): TaskItem {
  const status = str(r, 'status') as TaskStatus;
  return {
    id: str(r, '$id'),
    source: 'kintone',
    team: str(r, 'team'),
    assignee: str(r, 'tantou'),
    title: str(r, 'task_name'),
    doneDef: str(r, 'done_def'),
    priority: str(r, 'priority') || 'P2',
    impact: str(r, 'impact'),
    due: str(r, 'due') || null,
    status: STATUSES.includes(status) ? status : '未着手',
    yanai: str(r, 'yanai'),
    memo: str(r, 'memo'),
    updatedAt: str(r, '更新日時') || null,
  };
}

function toKintone(input: Partial<TaskInputType>): Record<string, { value: string }> {
  const rec: Record<string, { value: string }> = {};
  if (input.team !== undefined) rec.team = { value: input.team };
  if (input.assignee !== undefined) rec.tantou = { value: input.assignee };
  if (input.title !== undefined) rec.task_name = { value: input.title };
  if (input.doneDef !== undefined) rec.done_def = { value: input.doneDef };
  if (input.priority !== undefined) rec.priority = { value: input.priority };
  if (input.impact !== undefined) rec.impact = { value: input.impact };
  if (input.due !== undefined) rec.due = { value: input.due };
  if (input.status !== undefined) rec.status = { value: input.status };
  if (input.yanai !== undefined) rec.yanai = { value: input.yanai };
  if (input.memo !== undefined) rec.memo = { value: input.memo };
  return rec;
}

type LocalTask = {
  id: string;
  title: string;
  team: string | null;
  assigneeName: string | null;
  doneDef: string | null;
  kPriority: string | null;
  impact: string | null;
  dueDate: Date | null;
  status: string;
  yanai: string | null;
  memo: string | null;
  updatedAt: Date;
};

const LOCAL_STATUS: Record<string, TaskStatus> = {
  todo: '未着手',
  doing: '進行中',
  waiting: '確認待ち',
  done: '完了',
};
const LOCAL_STATUS_REV: Record<TaskStatus, string> = {
  未着手: 'todo',
  進行中: 'doing',
  確認待ち: 'waiting',
  完了: 'done',
};

function fromLocal(t: LocalTask): TaskItem {
  return {
    id: t.id,
    source: 'local',
    team: t.team ?? '',
    assignee: t.assigneeName ?? '未割当',
    title: t.title,
    doneDef: t.doneDef ?? '',
    priority: t.kPriority ?? 'P2',
    impact: t.impact ?? '',
    due: t.dueDate ? jstDateKey(t.dueDate) : null,
    status: LOCAL_STATUS[t.status] ?? '未着手',
    yanai: t.yanai ?? '',
    memo: t.memo ?? '',
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toLocal(input: Partial<TaskInputType>) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.team !== undefined ? { team: input.team } : {}),
    ...(input.assignee !== undefined ? { assigneeName: input.assignee } : {}),
    ...(input.doneDef !== undefined ? { doneDef: input.doneDef } : {}),
    ...(input.priority !== undefined ? { kPriority: input.priority } : {}),
    ...(input.impact !== undefined ? { impact: input.impact } : {}),
    ...(input.due !== undefined ? { dueDate: new Date(`${input.due}T00:00:00+09:00`) } : {}),
    ...(input.status !== undefined ? { status: LOCAL_STATUS_REV[input.status] } : {}),
    ...(input.yanai !== undefined ? { yanai: input.yanai } : {}),
    ...(input.memo !== undefined ? { memo: input.memo } : {}),
  };
}

const DEFAULT_OPTIONS: TaskOptions = { teams: TEAMS, members: MEMBERS };

function describeError(e: unknown): string {
  if (e instanceof KintoneError) {
    if (e.code === 'NOT_CONFIGURED') return 'Kintone未接続（環境変数 KINTONE_BASE_URL / KINTONE_API_TOKEN_TASK が未設定）';
    if (e.status === 401 || e.status === 403) return 'Kintoneの認証に失敗しました（APIトークンの権限を確認）';
    if (e.status === 404) return `Kintoneにアプリ ${kintoneTaskAppId()} が見つかりません（KINTONE_TASK_APP_ID を確認）`;
    return `Kintone接続エラー: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function listTasks(): Promise<TaskListResult> {
  const appId = kintoneTaskAppId();
  if (kintoneTaskConfigured()) {
    try {
      const [records, opts] = await Promise.all([
        fetchAllRecords(appId),
        fetchDropdownOptions(appId, ['team', 'tantou']).catch(() => ({}) as Record<string, string[]>),
      ]);
      return {
        tasks: records.map(fromKintone),
        options: {
          teams: opts.team?.length ? opts.team : TEAMS,
          members: opts.tantou?.length ? opts.tantou : MEMBERS,
        },
        source: 'kintone',
        notice: null,
        appId,
      };
    } catch (e) {
      // 接続失敗時は成功と偽らず、ローカルのタスクを読み取り専用で見せる
      const local = await prisma.task.findMany({ orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] });
      return {
        tasks: local.map(fromLocal),
        options: DEFAULT_OPTIONS,
        source: 'local',
        notice: `${describeError(e)}。ローカル保存分を表示しています`,
        appId,
      };
    }
  }
  const local = await prisma.task.findMany({ orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] });
  return {
    tasks: local.map(fromLocal),
    options: DEFAULT_OPTIONS,
    source: 'local',
    notice: 'Kintone未接続のため、このダッシュボード内のDBに保存します（接続後はKintoneタスク管理(38)が正になります）',
    appId,
  };
}

export async function createTask(input: TaskInputType): Promise<TaskItem> {
  if (kintoneTaskConfigured()) {
    const res = await addRecord(kintoneTaskAppId(), toKintone(input));
    return { ...input, id: res.id, source: 'kintone', updatedAt: new Date().toISOString() };
  }
  const t = await prisma.task.create({ data: { ...toLocal(input), title: input.title } });
  return fromLocal(t);
}

export async function updateTask(id: string, input: Partial<TaskInputType>): Promise<void> {
  if (kintoneTaskConfigured()) {
    await updateRecord(kintoneTaskAppId(), id, toKintone(input));
    return;
  }
  await prisma.task.update({ where: { id }, data: toLocal(input) });
}

/** 朝礼台本と同じ集計（期限超過・本日期限・P1未完了・昨日完了） */
export interface BoardStats {
  today: string;
  overdue: number;
  dueToday: number;
  p1Open: number;
  doneYesterday: number;
  open: number;
}

export function computeBoardStats(tasks: TaskItem[], now = new Date()): BoardStats {
  const today = jstDateKey(now);
  const yesterday = jstDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  let overdue = 0;
  let dueToday = 0;
  let p1Open = 0;
  let doneYesterday = 0;
  let open = 0;
  for (const t of tasks) {
    const isOpen = t.status !== '完了';
    if (isOpen) {
      open++;
      if (t.due && t.due < today) overdue++;
      if (t.due === today) dueToday++;
      if (t.priority === 'P1') p1Open++;
    } else if (t.updatedAt && jstDateKey(new Date(t.updatedAt)) === yesterday) {
      doneYesterday++;
    }
  }
  return { today, overdue, dueToday, p1Open, doneYesterday, open };
}
