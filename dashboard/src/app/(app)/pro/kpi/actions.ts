'use server';

// KPI のサーバーアクション。定義変更は管理職以上、値の記録はリーダー以上、改善タスク作成は書込権限（editor以上）。
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { canWrite } from '@/lib/auth';
import { requireActor, requireLevel } from '@/lib/rbac';
import { createTask, TaskInput } from '@/lib/tasks';
import { linkProjectKpi } from '@/lib/pro/tasks2';
import { TEAM_DEFS } from '@/lib/pro/teams';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

function revalidate(code?: string) {
  revalidatePath('/pro/kpi');
  if (code) revalidatePath(`/pro/kpi/${code}`);
  revalidatePath('/pro/tasks');
}

const num = (label: string) =>
  z.preprocess(
    (v) => (v === '' || v == null ? null : typeof v === 'string' ? Number(v.replace(/,/g, '')) : v),
    z.number({ message: `${label}は数値で入力してください` }).finite().nullable(),
  );

const KpiUpsert = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'コードは2文字以上')
    .max(40, 'コードは40文字以内')
    .regex(/^[a-z][a-z0-9_]*$/, 'コードは英小文字で始まり、英小文字・数字・_ のみ'),
  name: z.string().trim().min(1, 'KPI名を入力してください').max(60, 'KPI名は60文字以内'),
  unit: z.enum(['円', '%', '件', '倍', '個'], { message: '単位を選んでください' }),
  direction: z.enum(['up', 'down'], { message: '方向を選んでください' }),
  targetValue: num('目標値'),
  warnThreshold: num('注意の閾値'),
  dangerThreshold: num('危険の閾値'),
  teamCode: z.string().trim().refine((v) => v === '' || TEAM_DEFS.some((t) => t.code === v), '部署の指定が不正です'),
  note: z.string().trim().max(400, '補足は400文字以内').default(''),
  active: z.boolean().default(true),
});

/** KPI 定義の作成・更新（管理職以上） */
export async function upsertKpiAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireLevel('manager');
    if (!canWrite(actor.role)) return { ok: false, message: '閲覧者は KPI を変更できません' };
    const parsed = KpiUpsert.safeParse({
      code: form.get('code'),
      name: form.get('name'),
      unit: form.get('unit'),
      direction: form.get('direction'),
      targetValue: form.get('targetValue'),
      warnThreshold: form.get('warnThreshold'),
      dangerThreshold: form.get('dangerThreshold'),
      teamCode: form.get('teamCode') ?? '',
      note: form.get('note') ?? '',
      active: form.get('active') !== 'off',
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    const data = {
      name: d.name,
      unit: d.unit,
      direction: d.direction,
      targetValue: d.targetValue,
      warnThreshold: d.warnThreshold,
      dangerThreshold: d.dangerThreshold,
      teamCode: d.teamCode || null,
      note: d.note || null,
      active: d.active,
    };
    await prisma.kpi.upsert({ where: { code: d.code }, create: { code: d.code, source: 'manual', ...data }, update: data });
    await audit(actor.id, 'kpi.upsert', `${d.code} ${d.name} ${d.direction} target=${d.targetValue ?? '-'} warn=${d.warnThreshold ?? '-'} danger=${d.dangerThreshold ?? '-'}`);
    revalidate(d.code);
    return { ok: true, message: `KPI「${d.name}」を保存しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

const KpiValueInput = z.object({
  code: z.string().trim().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付を入力してください'),
  value: z.preprocess(
    (v) => (typeof v === 'string' ? Number(v.replace(/,/g, '')) : v),
    z.number({ message: '値は数値で入力してください' }).finite('値は数値で入力してください'),
  ),
  note: z.string().trim().max(200, 'メモは200文字以内').default(''),
});

/** KPI 値の記録（リーダー以上）。同じ日付は上書き */
export async function addKpiValueAction(code: string, date: string, value: number | string, note = ''): Promise<ActionResult> {
  try {
    const actor = await requireLevel('leader');
    if (!canWrite(actor.role)) return { ok: false, message: '閲覧者は値を記録できません' };
    const parsed = KpiValueInput.safeParse({ code, date, value, note });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    const kpi = await prisma.kpi.findUnique({ where: { code: d.code }, select: { code: true, name: true } });
    if (!kpi) return { ok: false, message: `KPI「${d.code}」がありません` };
    const at = new Date(`${d.date}T00:00:00+09:00`);
    await prisma.kpiValue.upsert({
      where: { kpiCode_date: { kpiCode: d.code, date: at } },
      create: { kpiCode: d.code, date: at, value: d.value, note: d.note || null },
      update: { value: d.value, note: d.note || null },
    });
    await audit(actor.id, 'kpi.value', `${d.code} ${d.date} = ${d.value} ${d.note}`);
    revalidate(d.code);
    return { ok: true, message: `${kpi.name} の ${d.date} の値を記録しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '記録に失敗しました' };
  }
}

/** 改善タスクの作成（KPIカードから）。柳井ルール（期限・完了の定義）はそのまま必須 */
export async function createImprovementTaskAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (!canWrite(actor.role)) return { ok: false, message: '閲覧者はタスクを作成できません' };
    const kpiCode = String(form.get('kpiCode') ?? '').trim();
    const kpi = kpiCode ? await prisma.kpi.findUnique({ where: { code: kpiCode }, select: { code: true, name: true } }) : null;
    if (!kpi) return { ok: false, message: '対象の KPI が見つかりません' };
    const parsed = TaskInput.safeParse({
      title: form.get('title'),
      team: form.get('team'),
      assignee: form.get('assignee'),
      doneDef: form.get('doneDef'),
      priority: form.get('priority') || 'P2',
      impact: form.get('impact') || '◎ 売上に直結',
      due: form.get('due'),
      status: '未着手',
      yanai: form.get('yanai') ?? '',
      memo: form.get('memo') ?? '',
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const t = await createTask(parsed.data);
    // 作成直後に KPI と紐づけ（Kintone 由来なら影の行を作る）＋依頼元を記録
    const ref = await linkProjectKpi(t.id, undefined, kpi.code);
    await prisma.task.update({ where: { id: ref.localId }, data: { requestedByUserId: actor.id } }).catch(() => undefined);
    await audit(actor.id, 'task.create', `${t.source}:${t.id} ${t.assignee} / ${t.title} (kpi=${kpi.code})`);
    revalidate(kpi.code);
    revalidatePath('/tasks');
    return { ok: true, message: `改善タスク「${t.title}」を ${t.assignee} さんに登録し、${kpi.name} に紐づけました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '作成に失敗しました' };
  }
}
