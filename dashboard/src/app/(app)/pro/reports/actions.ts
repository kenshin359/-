'use server';

// 報告のサーバーアクション。作成は書込権限（editor以上）、確認済みはリーダー以上、中間報告の自動生成は管理職以上。
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { canWrite } from '@/lib/auth';
import { requireActor, requireLevel } from '@/lib/rbac';
import { composeInterimDraft, loadOpenAlerts, ReportInput, type InterimDraft } from '@/lib/pro/reports';
import { listTasks2 } from '@/lib/pro/tasks2';
import { TEAM_DEFS } from '@/lib/pro/teams';

export type ActionResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

function pick(form: FormData) {
  return {
    type: form.get('type'),
    teamCode: form.get('teamCode') ?? '',
    periodFrom: form.get('periodFrom'),
    periodTo: form.get('periodTo'),
    title: form.get('title'),
    status: form.get('status') || 'submitted',
    body: {
      numbers: form.get('numbers') ?? '',
      learned: form.get('learned') ?? '',
      next: form.get('next') ?? '',
      issues: form.get('issues') ?? '',
      requests: form.get('requests') ?? '',
    },
  };
}

export async function createReportAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (!canWrite(actor.role)) return { ok: false, message: '閲覧者は報告を作成できません' };
    const parsed = ReportInput.safeParse(pick(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.periodFrom > d.periodTo) return { ok: false, message: '期間の開始が終了より後になっています' };
    const id = String(form.get('id') ?? '').trim();
    const data = {
      type: d.type,
      teamCode: d.teamCode || null,
      periodFrom: new Date(`${d.periodFrom}T00:00:00+09:00`),
      periodTo: new Date(`${d.periodTo}T00:00:00+09:00`),
      title: d.title,
      body: JSON.stringify(d.body),
      status: d.status,
    };
    if (id) {
      const existing = await prisma.report.findUnique({ where: { id }, select: { authorUserId: true, status: true } });
      if (!existing) return { ok: false, message: '報告が見つかりません' };
      if (existing.authorUserId !== actor.id && actor.role !== 'admin') return { ok: false, message: '他の人の報告は編集できません' };
      if (existing.status === 'reviewed') return { ok: false, message: '確認済みの報告は編集できません' };
      await prisma.report.update({ where: { id }, data });
      await audit(actor.id, 'report.update', `${id} ${d.type} ${d.teamCode || '-'} ${d.title}`);
      revalidatePath('/pro/reports');
      return { ok: true, message: '報告を更新しました', id };
    }
    const r = await prisma.report.create({ data: { ...data, authorUserId: actor.id, authorName: actor.name } });
    await audit(actor.id, 'report.create', `${r.id} ${d.type} ${d.teamCode || '-'} ${d.title}`);
    revalidatePath('/pro/reports');
    revalidatePath('/pro');
    return { ok: true, message: d.status === 'draft' ? '下書きを保存しました' : '報告を提出しました', id: r.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

/** 確認済みにする（リーダー以上） */
export async function reviewAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireLevel('leader');
    const rid = z.string().trim().min(1, '報告IDがありません').max(80).safeParse(id);
    if (!rid.success) return { ok: false, message: rid.error.issues[0].message };
    const r = await prisma.report.findUnique({ where: { id: rid.data }, select: { id: true, status: true, title: true } });
    if (!r) return { ok: false, message: '報告が見つかりません' };
    if (r.status === 'draft') return { ok: false, message: '下書きは確認済みにできません（提出してもらってください）' };
    await prisma.report.update({ where: { id: r.id }, data: { status: 'reviewed', reviewedByUserId: actor.id, reviewedAt: new Date() } });
    await audit(actor.id, 'report.review', `${r.id} ${r.title}`);
    revalidatePath('/pro/reports');
    return { ok: true, message: `「${r.title}」を確認済みにしました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '更新に失敗しました' };
  }
}

export type DraftResult = { ok: true; draft: InterimDraft; notice: string | null } | { ok: false; message: string };

/** リーダー向け中間報告の下書きを、タスク状況とアラートから決定的に組み立てる（管理職以上・保存はしない） */
export async function generateInterimAction(teamCode: string): Promise<DraftResult> {
  try {
    await requireLevel('manager');
    const code = z.string().trim().min(1, '部署を選んでください').safeParse(teamCode);
    if (!code.success) return { ok: false, message: code.error.issues[0].message };
    if (!TEAM_DEFS.some((t) => t.code === code.data)) return { ok: false, message: '部署の指定が不正です' };
    const [tasks, alerts] = await Promise.all([listTasks2(), loadOpenAlerts()]);
    const draft = composeInterimDraft(code.data, tasks.tasks, alerts);
    return { ok: true, draft, notice: tasks.notice };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '生成に失敗しました' };
  }
}
