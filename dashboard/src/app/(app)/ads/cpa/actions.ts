'use server';

// 合算CPAのサーバーアクション。画面の出し分けに頼らず、ここで必ずロールを検証する（viewerは全書込拒否）。
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions, canWrite } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseCpaPaste } from '@/lib/cpa-import';
import { CPA_SETTING_KEYS } from '@/lib/cpa-data';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function requireWriter() {
  const session = await getServerSession(authOptions);
  if (!session || !canWrite(session.user.role)) throw new Error('編集者以上のみ操作できます');
  return session;
}

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail } });
}

const intField = z.preprocess(
  (v) => (v === '' || v == null ? null : Number(String(v).replace(/[,¥￥\s]/g, ''))),
  z.number().int().min(0).nullable(),
);

const DayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付の形式が不正です'),
  suitcaseSales: intField,
  meta: intField,
  amazonAds: intField,
  rpp: intField,
  google: intField,
  other: intField,
  unitsAmazon: intField,
  unitsRakuten: intField,
  unitsOwn: intField,
  note: z.string().max(200).optional(),
});

export async function saveDayAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const raw: Record<string, FormDataEntryValue | null> = {};
    for (const k of Object.keys(DayInput.shape)) raw[k] = form.get(k);
    const parsed = DayInput.safeParse(raw);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    const data = {
      suitcaseSales: d.suitcaseSales,
      meta: d.meta ?? 0,
      amazonAds: d.amazonAds ?? 0,
      rpp: d.rpp ?? 0,
      google: d.google ?? 0,
      other: d.other ?? 0,
      unitsAmazon: d.unitsAmazon ?? 0,
      unitsRakuten: d.unitsRakuten ?? 0,
      unitsOwn: d.unitsOwn ?? 0,
      note: d.note?.trim() || null,
      updatedBy: session.user.name,
    };
    await prisma.cpaDaily.upsert({ where: { date: d.date }, update: data, create: { date: d.date, ...data } });
    await audit(session.user.id, 'cpa.save_day', d.date);
    revalidatePath('/ads/cpa');
    return { ok: true, message: `${d.date} を保存しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

export async function deleteDayAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const date = String(form.get('date') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: '日付が不正です' };
    await prisma.cpaDaily.delete({ where: { date } });
    await audit(session.user.id, 'cpa.delete_day', date);
    revalidatePath('/ads/cpa');
    return { ok: true, message: `${date} を削除しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '削除に失敗しました' };
  }
}

export async function importPasteAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const month = String(form.get('month') ?? '');
    if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: '対象月が不正です' };
    const text = String(form.get('text') ?? '');
    const parsed = parseCpaPaste(text, month);
    if (!parsed.rows.length) return { ok: false, message: parsed.skipped[0] ?? '取り込める行がありません' };
    let created = 0;
    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const r of parsed.rows) {
        const exists = await tx.cpaDaily.findUnique({ where: { date: r.date }, select: { date: true } });
        const data = { ...r, updatedBy: session.user.name };
        await tx.cpaDaily.upsert({ where: { date: r.date }, update: data, create: data });
        if (exists) updated++;
        else created++;
      }
    });
    await audit(session.user.id, 'cpa.import_paste', `${month} 新規${created}件 更新${updated}件`);
    revalidatePath('/ads/cpa');
    const warn = parsed.skipped.length ? `（読めなかった行 ${parsed.skipped.length}件: ${parsed.skipped[0]}）` : '';
    return { ok: true, message: `取り込みました: 新規${created}件・更新${updated}件${warn}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '取込に失敗しました' };
  }
}

const ThresholdInput = z.object({
  aov: z.coerce.number().int().min(1, '客単価は1以上'),
  targetRatio: z.coerce.number().min(0.1).max(100),
  limitRatio: z.coerce.number().min(0.1).max(100),
});

export async function saveThresholdsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') throw new Error('判定基準の変更は管理者のみです');
    const parsed = ThresholdInput.safeParse({
      aov: form.get('aov'),
      targetRatio: form.get('targetRatio'),
      limitRatio: form.get('limitRatio'),
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const { aov, targetRatio, limitRatio } = parsed.data;
    if (limitRatio < targetRatio) return { ok: false, message: '許容比率は目標比率以上にしてください' };
    const entries: [string, string][] = [
      [CPA_SETTING_KEYS.aov, String(aov)],
      [CPA_SETTING_KEYS.targetRatio, String(targetRatio / 100)],
      [CPA_SETTING_KEYS.limitRatio, String(limitRatio / 100)],
    ];
    await prisma.$transaction(
      entries.map(([key, value]) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })),
    );
    await audit(session.user.id, 'cpa.thresholds', `客単価${aov} 目標${targetRatio}% 許容${limitRatio}%`);
    revalidatePath('/ads/cpa');
    return { ok: true, message: '判定基準を保存しました' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}
