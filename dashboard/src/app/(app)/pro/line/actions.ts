'use server';

// LINE監査役 管理画面のサーバーアクション。画面の出し分けに頼らず、ここで必ず管理職以上を検証する。
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireLevel } from '@/lib/rbac';
import { createTask, TaskInput } from '@/lib/tasks';
import { isValidCron } from '@/lib/line/cron';
import { followUpDetail, lineAudit, markFollowUpDone, remindAtFor } from '@/lib/line/service';
import { teamByCode } from '@/lib/pro/teams';
import { jstDateKey } from '@/lib/metrics/format';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const PATH = '/pro/line';

function fail(e: unknown, fallback: string): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

const Id = z.string().trim().min(1).max(64);
const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD で入力してください');

// ---------- グループ ----------

const SetTeam = z.object({ groupId: Id, teamCode: z.string().trim().max(32) });

export async function setGroupTeamAction(input: z.infer<typeof SetTeam>): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = SetTeam.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0].message };
    const code = p.data.teamCode || null;
    if (code && !teamByCode(code)) return { ok: false, message: '不明な部署コードです' };
    await prisma.lineGroup.update({ where: { groupId: p.data.groupId }, data: { teamCode: code } });
    await lineAudit('group.team', `group=${p.data.groupId} team=${code ?? '-'}`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: code ? `部署を「${teamByCode(code)?.name}」にしました` : '部署の割当を外しました' };
  } catch (e) {
    return fail(e, '更新に失敗しました');
  }
}

const SetActive = z.object({ groupId: Id, active: z.boolean() });

export async function setGroupActiveAction(input: z.infer<typeof SetActive>): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = SetActive.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0].message };
    await prisma.lineGroup.update({ where: { groupId: p.data.groupId }, data: { active: p.data.active } });
    await lineAudit('group.active', `group=${p.data.groupId} active=${p.data.active}`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: p.data.active ? '有効にしました' : '停止しました（追いかけ・定時投稿を送りません）' };
  } catch (e) {
    return fail(e, '更新に失敗しました');
  }
}

// ---------- 追いかけ（FollowUp） ----------

export async function completeFollowUpAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = Id.safeParse(id);
    if (!p.success) return { ok: false, message: 'IDが不正です' };
    const f = await prisma.followUp.findUnique({ where: { id: p.data } });
    if (!f) return { ok: false, message: '見つかりません' };
    if (f.status === 'done') return { ok: true, message: 'すでに完了です' };
    await markFollowUpDone(f.id, actor.name, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: `「${f.title}」を完了にしました` };
  } catch (e) {
    return fail(e, '更新に失敗しました');
  }
}

export async function dropFollowUpAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = Id.safeParse(id);
    if (!p.success) return { ok: false, message: 'IDが不正です' };
    const f = await prisma.followUp.update({ where: { id: p.data }, data: { status: 'dropped', remindAt: null } });
    await lineAudit('followup.drop', `${followUpDetail(f)} by=${actor.name}`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: `「${f.title}」を取り下げました` };
  } catch (e) {
    return fail(e, '更新に失敗しました');
  }
}

export async function reopenFollowUpAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = Id.safeParse(id);
    if (!p.success) return { ok: false, message: 'IDが不正です' };
    const now = new Date();
    const cur = await prisma.followUp.findUnique({ where: { id: p.data } });
    if (!cur) return { ok: false, message: '見つかりません' };
    const dueKey = cur.due ? jstDateKey(cur.due) : null;
    const f = await prisma.followUp.update({
      where: { id: p.data },
      data: { status: 'open', remindAt: remindAtFor(dueKey, now) },
    });
    await lineAudit('followup.reopen', `${followUpDetail(f)} by=${actor.name}`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: `「${f.title}」を未完了に戻しました` };
  } catch (e) {
    return fail(e, '更新に失敗しました');
  }
}

const SetDue = z.object({ id: Id, due: DateKey.nullable(), assigneeName: z.string().trim().max(40).optional() });

export async function setFollowUpDueAction(input: z.infer<typeof SetDue>): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = SetDue.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0].message };
    const now = new Date();
    const f = await prisma.followUp.update({
      where: { id: p.data.id },
      data: {
        due: p.data.due ? new Date(`${p.data.due}T00:00:00+09:00`) : null,
        remindAt: remindAtFor(p.data.due, now),
        remindedCount: 0,
        ...(p.data.assigneeName !== undefined ? { assigneeName: p.data.assigneeName || null } : {}),
      },
    });
    await lineAudit('followup.due', `${followUpDetail(f)} by=${actor.name}`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: p.data.due ? `期限を ${p.data.due} にしました（翌朝9時から追いかけ）` : '期限を外しました（3日後に追いかけ）' };
  } catch (e) {
    return fail(e, '更新に失敗しました');
  }
}

const ToTask = z.object({
  id: Id,
  team: z.string().trim().min(1, 'チームを選んでください'),
  assignee: z.string().trim().min(1, '担当者を選んでください'),
  due: DateKey,
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P2'),
});

/** タスク化: Kintone(38) か ローカルDB に登録し、FollowUp.taskId に紐づける */
export async function followUpToTaskAction(input: z.infer<typeof ToTask>): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = ToTask.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0].message };
    const f = await prisma.followUp.findUnique({ where: { id: p.data.id }, include: { source: { select: { groupId: true } } } });
    if (!f) return { ok: false, message: '見つかりません' };
    if (f.taskId) return { ok: false, message: `すでにタスク化済みです（${f.taskId}）` };
    const group = f.groupId ? await prisma.lineGroup.findUnique({ where: { groupId: f.groupId } }) : null;
    const parsed = TaskInput.safeParse({
      title: f.title.slice(0, 120),
      team: p.data.team,
      assignee: p.data.assignee,
      doneDef: f.title.slice(0, 200),
      priority: p.data.priority,
      impact: '○ 間接（計測・基盤）',
      due: p.data.due,
      status: '未着手',
      yanai: '',
      memo: `LINE監査役より（グループ: ${group?.name ?? f.groupId ?? '-'}）`,
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const t = await createTask(parsed.data);
    const taskId = `${t.source}:${t.id}`;
    await prisma.followUp.update({
      where: { id: f.id },
      data: {
        taskId,
        assigneeName: p.data.assignee,
        due: new Date(`${p.data.due}T00:00:00+09:00`),
        remindAt: remindAtFor(p.data.due, new Date()),
      },
    });
    await lineAudit('followup.task', `${followUpDetail(f)} → ${taskId} by=${actor.name}`, actor.id);
    revalidatePath(PATH);
    revalidatePath('/tasks');
    return { ok: true, message: `タスク化しました（${t.source === 'kintone' ? 'Kintone' : 'ローカル'} #${t.id}）` };
  } catch (e) {
    return fail(e, 'タスク化に失敗しました');
  }
}

const NewFollowUp = z.object({
  groupId: Id,
  title: z.string().trim().min(1, '内容を入力してください').max(80, '80文字以内'),
  assigneeName: z.string().trim().max(40).optional(),
  due: DateKey.nullable(),
});

/** 手動で追いかけを追加（抽出漏れ・低確度候補の登録用） */
export async function createFollowUpAction(input: z.infer<typeof NewFollowUp>): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = NewFollowUp.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0].message };
    const now = new Date();
    const f = await prisma.followUp.create({
      data: {
        groupId: p.data.groupId,
        title: p.data.title,
        assigneeName: p.data.assigneeName || null,
        due: p.data.due ? new Date(`${p.data.due}T00:00:00+09:00`) : null,
        remindAt: remindAtFor(p.data.due, now),
      },
    });
    await lineAudit('followup.create', `${followUpDetail(f)} 手動 by=${actor.name}`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: '追いかけを追加しました' };
  } catch (e) {
    return fail(e, '追加に失敗しました');
  }
}

// ---------- 定時投稿 ----------

const PostInput = z.object({
  id: Id.optional(),
  groupId: Id,
  name: z.string().trim().min(1, '名前を入力してください').max(60),
  cron: z.string().trim().min(9, 'cron を入力してください（例: 0 8 * * 1-5）').max(60),
  template: z.enum(['daily_summary', 'due_reminder', 'custom']),
  body: z.string().trim().max(2000).default(''),
  active: z.boolean().default(true),
});

export async function savePostAction(input: z.infer<typeof PostInput>): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = PostInput.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0].message };
    if (!isValidCron(p.data.cron)) return { ok: false, message: 'cron の形式が不正です（分 時 日 月 曜日。例: 0 8 * * 1-5）' };
    if (p.data.template === 'custom' && !p.data.body) return { ok: false, message: '定型文の本文を入力してください' };
    const group = await prisma.lineGroup.findUnique({ where: { groupId: p.data.groupId } });
    if (!group) return { ok: false, message: 'グループが見つかりません' };
    const data = {
      groupId: p.data.groupId,
      name: p.data.name,
      cron: p.data.cron,
      template: p.data.template,
      body: p.data.body || null,
      active: p.data.active,
    };
    const saved = p.data.id
      ? await prisma.scheduledPost.update({ where: { id: p.data.id }, data })
      : await prisma.scheduledPost.create({ data });
    await lineAudit(p.data.id ? 'post.update' : 'post.create', `id=${saved.id} 「${saved.name}」 ${saved.cron} ${saved.template} group=${saved.groupId}`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: p.data.id ? '保存しました' : '定時投稿を追加しました' };
  } catch (e) {
    return fail(e, '保存に失敗しました');
  }
}

const TogglePost = z.object({ id: Id, active: z.boolean() });

export async function togglePostAction(input: z.infer<typeof TogglePost>): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = TogglePost.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0].message };
    const saved = await prisma.scheduledPost.update({ where: { id: p.data.id }, data: { active: p.data.active } });
    await lineAudit('post.toggle', `id=${saved.id} 「${saved.name}」 active=${saved.active}`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: saved.active ? '有効にしました' : '停止しました' };
  } catch (e) {
    return fail(e, '更新に失敗しました');
  }
}

export async function deletePostAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    const p = Id.safeParse(id);
    if (!p.success) return { ok: false, message: 'IDが不正です' };
    const saved = await prisma.scheduledPost.delete({ where: { id: p.data } });
    await lineAudit('post.delete', `id=${saved.id} 「${saved.name}」`, actor.id);
    revalidatePath(PATH);
    return { ok: true, message: '削除しました' };
  } catch (e) {
    return fail(e, '削除に失敗しました');
  }
}
