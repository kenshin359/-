'use server';

// 社員プロフィール・権限のサーバーアクション。
// 画面の出し分けに頼らず、ここで必ず「本人 or 管理者」「管理者のみ」を検証し、変更は AuditLog に残す。
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { LEVEL_JA, requireActor } from '@/lib/rbac';
import { teamByCode } from '@/lib/pro/teams';
import { canEditProfile, LevelTeamInput, ProfileInput, type LevelTeamInputType, type ProfileInputType } from '@/lib/pro/people';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

function revalidatePeople(userId: string) {
  revalidatePath('/pro/people');
  revalidatePath(`/pro/people/${userId}`);
  revalidatePath('/pro/settings');
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(after)) {
    const b = before[k] ?? '';
    const a = after[k] ?? '';
    if (b !== a) parts.push(`${k}: ${String(b) || '(空)'} → ${String(a) || '(空)'}`);
  }
  return parts.length ? parts.join(' / ') : '変更なし';
}

/** プロフィール更新（役職・Kintone担当者名・スキル・LINE userId）。本人 or 管理者のみ */
export async function updateProfileAction(userId: string, input: ProfileInputType): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (!userId || !canEditProfile(actor, userId)) return { ok: false, message: '本人または管理者のみ編集できます' };
    const parsed = ProfileInput.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, title: true, kintoneName: true, skills: true, lineUserId: true },
    });
    if (!before) return { ok: false, message: 'ユーザーが見つかりません' };

    const u = await prisma.user.update({ where: { id: userId }, data: parsed.data, select: { name: true } });
    const { name: _n, ...beforeFields } = before;
    void _n;
    await audit(actor.id, 'user.profile.update', `${u.name}(${userId}) ${diff(beforeFields, parsed.data)}`);
    revalidatePeople(userId);
    return { ok: true, message: `${u.name} のプロフィールを保存しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

/** 権限レベル・所属の変更。管理者（role=admin）のみ */
export async function assignLevelTeamAction(userId: string, input: LevelTeamInputType): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (actor.role !== 'admin') return { ok: false, message: '権限・所属の変更は管理者のみ操作できます' };
    if (!userId) return { ok: false, message: 'ユーザーが指定されていません' };
    const parsed = LevelTeamInput.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

    const before = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, level: true, teamCode: true } });
    if (!before) return { ok: false, message: 'ユーザーが見つかりません' };

    const u = await prisma.user.update({
      where: { id: userId },
      data: { level: parsed.data.level, teamCode: parsed.data.teamCode },
      select: { name: true },
    });
    const teamLabel = (c: string | null) => (c ? (teamByCode(c)?.name ?? c) : '未設定');
    await audit(
      actor.id,
      'user.level_team.update',
      `${u.name}(${userId}) level: ${LEVEL_JA[before.level as keyof typeof LEVEL_JA] ?? before.level} → ${LEVEL_JA[parsed.data.level]} / team: ${teamLabel(before.teamCode)} → ${teamLabel(parsed.data.teamCode)}`,
    );
    revalidatePeople(userId);
    return { ok: true, message: `${u.name} の権限・所属を保存しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}
