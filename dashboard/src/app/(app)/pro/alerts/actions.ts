'use server';

// アラートの解決・ミュート。画面の出し分けに頼らず、ここで必ずリーダー以上を検証する。
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireLevel } from '@/lib/rbac';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const MUTE_DAYS = [1, 3, 7, 14, 30] as const;

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

/**
 * 解決済みにする。条件が続いている間は再表示せず、いったん解消して再発したときに再オープンする
 * （resolvedAt と lastSeenAt を同じ時刻にするのが「手動解決」の印。lib/pro/alerts.ts の isManuallyResolved）
 */
export async function resolveAlertAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireLevel('leader');
    if (!id) return { ok: false, message: 'アラートIDがありません' };
    const a = await prisma.alert.findUnique({ where: { id } });
    if (!a) return { ok: false, message: 'アラートが見つかりません' };
    const now = new Date();
    await prisma.alert.update({ where: { id }, data: { resolvedAt: now, lastSeenAt: now } });
    await audit(actor.id, 'alert.resolve', `${a.code} ${a.entityType ?? ''}:${a.entityId ?? ''} ${a.title}`);
    revalidatePath('/pro/alerts');
    revalidatePath('/pro');
    return { ok: true, message: `「${a.title}」を解決済みにしました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '更新に失敗しました' };
  }
}

/** 指定日数ミュート（評価は続くが一覧に出さない） */
export async function muteAlertAction(id: string, days: number): Promise<ActionResult> {
  try {
    const actor = await requireLevel('leader');
    if (!id) return { ok: false, message: 'アラートIDがありません' };
    if (!(MUTE_DAYS as readonly number[]).includes(days)) return { ok: false, message: 'ミュート日数が不正です' };
    const a = await prisma.alert.findUnique({ where: { id } });
    if (!a) return { ok: false, message: 'アラートが見つかりません' };
    const until = new Date(Date.now() + days * 86_400_000);
    await prisma.alert.update({ where: { id }, data: { mutedUntil: until } });
    await audit(actor.id, 'alert.mute', `${a.code} ${a.entityType ?? ''}:${a.entityId ?? ''} ${days}日 ${a.title}`);
    revalidatePath('/pro/alerts');
    revalidatePath('/pro');
    return { ok: true, message: `「${a.title}」を${days}日間ミュートしました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '更新に失敗しました' };
  }
}
