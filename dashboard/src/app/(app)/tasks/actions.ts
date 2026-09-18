'use server';

// タスク管理のサーバーアクション。画面の出し分けに頼らず、ここで必ず editor 以上を検証する。
// 正はKintone(38)。未接続時はローカルDB（lib/tasks.ts が振り分ける）。
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions, canWrite } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createTask, STATUSES, TaskInput, updateTask, type TaskStatus } from '@/lib/tasks';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function requireEditor() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error('ログインが必要です');
  if (!canWrite(session.user.role)) throw new Error('閲覧者はタスクを編集できません');
  return session;
}

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

function pick(form: FormData) {
  return {
    title: form.get('title'),
    team: form.get('team'),
    assignee: form.get('assignee'),
    doneDef: form.get('doneDef'),
    priority: form.get('priority') || 'P2',
    impact: form.get('impact') || '○ 間接（計測・基盤）',
    due: form.get('due'),
    status: form.get('status') || '未着手',
    yanai: form.get('yanai') ?? '',
    memo: form.get('memo') ?? '',
  };
}

export async function createTaskAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireEditor();
    const parsed = TaskInput.safeParse(pick(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const t = await createTask(parsed.data);
    await audit(session.user.id, 'task.create', `${t.source}:${t.id} ${t.assignee} / ${t.title}`);
    revalidatePath('/tasks');
    revalidatePath('/pro', 'layout');
    return { ok: true, message: `「${t.title}」を ${t.assignee} さんに登録しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '登録に失敗しました' };
  }
}

export async function updateTaskAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireEditor();
    const id = String(form.get('id') ?? '');
    if (!id) return { ok: false, message: 'タスクIDがありません' };
    const parsed = TaskInput.safeParse(pick(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    await updateTask(id, parsed.data);
    await audit(session.user.id, 'task.update', `${id} ${parsed.data.assignee} / ${parsed.data.title}`);
    revalidatePath('/tasks');
    revalidatePath('/pro', 'layout');
    return { ok: true, message: '保存しました' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

/** 状態だけを変える（毎朝「状態」だけ更新する運用に合わせた最短導線） */
export async function setTaskStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const session = await requireEditor();
    if (!id) return { ok: false, message: 'タスクIDがありません' };
    if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, message: '不正な状態です' };
    await updateTask(id, { status: status as TaskStatus });
    await audit(session.user.id, 'task.status', `${id} → ${status}`);
    revalidatePath('/tasks');
    revalidatePath('/pro', 'layout');
    return { ok: true, message: `状態を「${status}」にしました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '更新に失敗しました' };
  }
}
