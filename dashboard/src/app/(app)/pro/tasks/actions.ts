'use server';

// タスク2.0 のサーバーアクション。画面の出し分けに頼らず、ここで必ず editor 以上（書込権限）を検証する。
// PRO 固有項目（進捗・保留・プロジェクト・KPI）はローカルの Task 行に保存する（lib/pro/tasks2.ts）。
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { canWrite } from '@/lib/auth';
import { requireActor, type Actor } from '@/lib/rbac';
import { holdTask, linkProjectKpi, projectCodeFromName, resumeTask, setProgress } from '@/lib/pro/tasks2';
import { TEAM_DEFS } from '@/lib/pro/teams';

export type ActionResult = { ok: true; message: string; code?: string } | { ok: false; message: string };

async function requireEditor(): Promise<Actor> {
  const actor = await requireActor();
  if (!canWrite(actor.role)) throw new Error('閲覧者はタスクを変更できません');
  return actor;
}

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

function revalidate() {
  revalidatePath('/pro/tasks');
  revalidatePath('/pro/kpi');
  revalidatePath('/tasks');
}

const Progress = z.number().int().min(0).max(100);
const Id = z.string().trim().min(1, 'タスクIDがありません').max(80);

export async function setProgressAction(id: string, progress: number): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const pid = Id.safeParse(id);
    const p = Progress.safeParse(progress);
    if (!pid.success) return { ok: false, message: pid.error.issues[0].message };
    if (!p.success) return { ok: false, message: '進捗率は0〜100の整数で指定してください' };
    const ref = await setProgress(pid.data, p.data);
    await audit(actor.id, 'task.progress', `${ref.source}:${ref.id} → ${p.data}% / ${ref.title}`);
    revalidate();
    return { ok: true, message: `進捗を ${p.data}% にしました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '更新に失敗しました' };
  }
}

const HoldReason = z.string().trim().min(1, '保留の理由を書いてください（何を待っているか）').max(200, '理由は200文字以内');

export async function holdTaskAction(id: string, reason: string): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const pid = Id.safeParse(id);
    const r = HoldReason.safeParse(reason);
    if (!pid.success) return { ok: false, message: pid.error.issues[0].message };
    if (!r.success) return { ok: false, message: r.error.issues[0].message };
    const ref = await holdTask(pid.data, r.data);
    await audit(actor.id, 'task.hold', `${ref.source}:${ref.id} 理由: ${r.data} / ${ref.title}`);
    revalidate();
    return { ok: true, message: '保留にしました（Kintone側は「確認待ち」のままです）' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保留にできませんでした' };
  }
}

export async function resumeAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const pid = Id.safeParse(id);
    if (!pid.success) return { ok: false, message: pid.error.issues[0].message };
    const ref = await resumeTask(pid.data);
    await audit(actor.id, 'task.resume', `${ref.source}:${ref.id} / ${ref.title}`);
    revalidate();
    return { ok: true, message: '保留を解除し「進行中」に戻しました' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '解除できませんでした' };
  }
}

const Code = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z0-9_-]*$/, 'コードは英小文字・数字・-・_ のみ')
  .optional();

export async function linkProjectKpiAction(id: string, projectCode?: string | null, kpiCode?: string | null): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const pid = Id.safeParse(id);
    if (!pid.success) return { ok: false, message: pid.error.issues[0].message };
    const pc = Code.safeParse(projectCode ?? undefined);
    const kc = Code.safeParse(kpiCode ?? undefined);
    if (!pc.success) return { ok: false, message: `プロジェクト${pc.error.issues[0].message}` };
    if (!kc.success) return { ok: false, message: `KPI${kc.error.issues[0].message}` };
    if (pc.data && !(await prisma.project.findUnique({ where: { code: pc.data }, select: { code: true } }))) {
      return { ok: false, message: `プロジェクト「${pc.data}」がありません` };
    }
    if (kc.data && !(await prisma.kpi.findUnique({ where: { code: kc.data }, select: { code: true } }))) {
      return { ok: false, message: `KPI「${kc.data}」がありません` };
    }
    const ref = await linkProjectKpi(pid.data, projectCode === undefined ? undefined : pc.data ?? '', kpiCode === undefined ? undefined : kc.data ?? '');
    await audit(actor.id, 'task.link', `${ref.source}:${ref.id} project=${pc.data ?? '-'} kpi=${kc.data ?? '-'} / ${ref.title}`);
    revalidate();
    return { ok: true, message: '紐づけを保存しました' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

const ProjectInput = z.object({
  name: z.string().trim().min(1, 'プロジェクト名を入力してください').max(80, 'プロジェクト名は80文字以内'),
  teamCode: z
    .string()
    .trim()
    .refine((v) => v === '' || TEAM_DEFS.some((t) => t.code === v), '部署の指定が不正です'),
  ownerUserId: z.string().trim().max(80).default(''),
  dueDate: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), '期限の形式が不正です'),
  goal: z.string().trim().max(400, '目標は400文字以内').default(''),
  kpiCode: z.string().trim().max(60).default(''),
});

export async function createProjectAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const parsed = ProjectInput.safeParse({
      name: form.get('name'),
      teamCode: form.get('teamCode') ?? '',
      ownerUserId: form.get('ownerUserId') ?? '',
      dueDate: form.get('dueDate') ?? '',
      goal: form.get('goal') ?? '',
      kpiCode: form.get('kpiCode') ?? '',
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.ownerUserId && !(await prisma.user.findUnique({ where: { id: d.ownerUserId }, select: { id: true } }))) {
      return { ok: false, message: '責任者のユーザーが見つかりません' };
    }
    if (d.kpiCode && !(await prisma.kpi.findUnique({ where: { code: d.kpiCode }, select: { code: true } }))) {
      return { ok: false, message: `KPI「${d.kpiCode}」がありません` };
    }
    // コードは名前から自動生成。重複時は連番を付ける
    const base = projectCodeFromName(d.name);
    let code = base;
    for (let n = 2; await prisma.project.findUnique({ where: { code }, select: { code: true } }); n++) code = `${base}-${n}`;
    await prisma.project.create({
      data: {
        code,
        name: d.name,
        teamCode: d.teamCode || null,
        ownerUserId: d.ownerUserId || actor.id,
        status: 'active',
        goal: d.goal || null,
        kpiCode: d.kpiCode || null,
        startDate: new Date(),
        dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00+09:00`) : null,
      },
    });
    await audit(actor.id, 'project.create', `${code} ${d.name} team=${d.teamCode || '-'} due=${d.dueDate || '-'}`);
    revalidate();
    return { ok: true, message: `プロジェクト「${d.name}」を作成しました（コード: ${code}）`, code };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '作成に失敗しました' };
  }
}
