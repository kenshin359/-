'use server';

// LINE顧客対応のサーバーアクション。画面の出し分けに頼らず、ここでロール／権限を検証する。
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions, canWrite } from '@/lib/auth';
import { closeCase, getCase, touchCase } from '@/lib/line-support/cases';
import { MODES, type Mode } from '@/lib/line-support/categories';
import { pushText } from '@/lib/line-support/client';
import { markDismissed, markSent } from '@/lib/line-support/inquiries';
import { POLICY_KEYS } from '@/lib/line-support/policy';
import { saveReply } from '@/lib/line-support/store';
import { prisma } from '@/lib/prisma';
import { requireLevel } from '@/lib/rbac';

const PATH = '/pro/line-support';

async function requireWriter() {
  const session = await getServerSession(authOptions);
  if (!session || !canWrite(session.user.role)) throw new Error('編集者以上のみ操作できます');
  return session;
}

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

export async function closeCaseAction(form: FormData): Promise<void> {
  const session = await requireWriter();
  const no = Number(form.get('no'));
  if (!Number.isInteger(no) || no <= 0) throw new Error('案件番号が不正です');
  const c = await closeCase(no);
  if (c) {
    await prisma.inquiry.updateMany({ where: { caseNo: no, status: 'pending' }, data: { status: 'dismissed', resolvedAt: new Date() } }).catch(() => undefined);
    await audit(session.user.id, 'line.case.close', `#${no}`);
  }
  revalidatePath(PATH);
}

/** 回答案をそのまま、または書き換えてお客様へ送る */
export async function sendInquiryAction(form: FormData): Promise<void> {
  const session = await requireWriter();
  const id = String(form.get('id') ?? '');
  const text = String(form.get('text') ?? '').trim();
  const inq = await prisma.inquiry.findUnique({ where: { id } });
  if (!inq || inq.status !== 'pending') throw new Error('承認待ちの回答案が見つかりません');
  const body = text || inq.draft || '';
  if (!body) throw new Error('本文が空です');
  await pushText(inq.lineUserId, body);
  const edited = Boolean(inq.draft) && body !== inq.draft;
  await markSent(inq, body, `staff-web:${session.user.id}`, { edited, userId: session.user.id });
  await saveReply(inq.lineUserId, body, { needsHuman: false, reason: `${edited ? 'スタッフ返信' : 'スタッフ承認'}${inq.caseNo ? ` #${inq.caseNo}` : ''}`, topics: [] });
  if (inq.caseNo) {
    const c = await getCase(inq.caseNo);
    if (c) await touchCase(c.no);
  }
  await audit(session.user.id, edited ? 'line.inquiry.send_edited' : 'line.inquiry.approve', `${inq.id}${inq.caseNo ? ` #${inq.caseNo}` : ''}`);
  revalidatePath(PATH);
}

export async function dismissInquiryAction(form: FormData): Promise<void> {
  const session = await requireWriter();
  const id = String(form.get('id') ?? '');
  await markDismissed(id, session.user.id);
  await audit(session.user.id, 'line.inquiry.dismiss', id);
  revalidatePath(PATH);
}

/** カテゴリの運用モード変更（管理職以上） */
export async function setCategoryModeAction(form: FormData): Promise<void> {
  const actor = await requireLevel('manager');
  const code = String(form.get('code') ?? '');
  const mode = String(form.get('mode') ?? '');
  if (!(MODES as readonly string[]).includes(mode)) throw new Error('モードが不正です');
  const before = await prisma.inquiryCategory.findUnique({ where: { code } });
  if (!before) throw new Error('カテゴリが見つかりません');
  await prisma.inquiryCategory.update({ where: { code }, data: { mode: mode as Mode } });
  await prisma.correction.create({ data: { targetType: 'category', targetId: code, field: 'mode', before: before.mode, after: mode, userId: actor.id } }).catch(() => undefined);
  await audit(actor.id, 'line.category.mode', `${code}: ${before.mode} → ${mode}`);
  revalidatePath(PATH);
}

/** 自動返信の確信度しきい値（取締役以上） */
export async function setPolicyAction(form: FormData): Promise<void> {
  const actor = await requireLevel('director');
  const n = Number(form.get('csAutoMin'));
  if (!Number.isInteger(n) || n < 50 || n > 100) throw new Error('50〜100の整数で指定してください');
  await prisma.setting.upsert({ where: { key: POLICY_KEYS.csAutoMin }, create: { key: POLICY_KEYS.csAutoMin, value: String(n) }, update: { value: String(n) } });
  await audit(actor.id, 'line.policy.csAutoMin', String(n));
  revalidatePath(PATH);
}
