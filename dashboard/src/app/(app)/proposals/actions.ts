'use server';

// AI改善提案の状態変更。画面の出し分けに頼らず、ここで必ず editor 以上を検証し AuditLog に残す。
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions, canWrite } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isDemoProposal, isProposalStatus, PROPOSAL_STATUS_JA } from '@/lib/metrics/proposals';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function requireEditor() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error('ログインが必要です');
  if (!canWrite(session.user.role)) throw new Error('閲覧者は提案の状態を変更できません');
  return session;
}

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

/** 状態（open/adopted/held/rejected）とメモを更新する */
export async function setProposalStatusAction(id: string, status: string, statusNote: string): Promise<ActionResult> {
  try {
    const session = await requireEditor();
    if (!id) return { ok: false, message: '提案IDがありません' };
    if (!isProposalStatus(status)) return { ok: false, message: '不正な状態です' };
    const note = statusNote.trim().slice(0, 500);
    const p = await prisma.proposal.findUnique({ where: { id } });
    if (!p) return { ok: false, message: '提案が見つかりません' };
    if (isDemoProposal(p)) return { ok: false, message: 'デモ提案は変更できません' };
    await prisma.proposal.update({ where: { id }, data: { status, statusNote: note || null } });
    await audit(session.user.id, 'proposal.status', `${id} ${p.status} → ${status}${note ? ` / ${note}` : ''} / ${p.title}`);
    revalidatePath('/proposals');
    revalidatePath('/');
    return { ok: true, message: `「${p.title}」を「${PROPOSAL_STATUS_JA[status]}」にしました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '更新に失敗しました' };
  }
}
