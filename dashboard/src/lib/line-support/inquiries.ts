import { prisma } from '@/lib/prisma';
import type { Answer } from './answer';
import type { Action } from './policy';

export type InquiryRow = {
  id: string;
  lineUserId: string;
  caseNo: number | null;
  userText: string;
  categoryCode: string | null;
  level: number | null;
  confidence: number | null;
  mode: string | null;
  action: string;
  status: string;
  draft: string | null;
  sentText: string | null;
  sentBy: string | null;
  kbRefs: string | null;
  reason: string | null;
  receivedAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
};

/** 問い合わせ台帳に1件記録し、AI判断ログも残す（失敗しても返信は止めない） */
export async function recordInquiry(args: {
  lineUserId: string;
  caseNo: number | null;
  userText: string;
  answer: Answer;
  mode: string;
  action: Action | 'forwarded';
  status: string;
  sentText?: string | null;
  sentBy?: string | null;
  firstResponseAt?: Date | null;
}): Promise<InquiryRow | null> {
  const a = args.answer;
  try {
    const row = await prisma.inquiry.create({
      data: {
        lineUserId: args.lineUserId,
        caseNo: args.caseNo,
        userText: args.userText,
        categoryCode: a.categoryCode,
        level: a.level,
        confidence: a.confidence,
        mode: args.mode,
        action: args.action,
        status: args.status,
        draft: a.source === 'ai' ? a.reply : null,
        sentText: args.sentText ?? null,
        sentBy: args.sentBy ?? null,
        kbRefs: a.kbRefs.length ? a.kbRefs.join(',') : null,
        reason: a.reason || null,
        firstResponseAt: args.firstResponseAt ?? null,
        resolvedAt: args.status === 'auto_sent' ? new Date() : null,
      },
    });
    await prisma.aiDecisionLog
      .create({
        data: {
          kind: 'cs',
          refId: row.id,
          model: a.meta.model,
          inputSummary: `len=${args.userText.length} category=${a.categoryCode} level=${a.level} action=${args.action} source=${a.source}`,
          outputJson: JSON.stringify({
            category: a.categoryCode,
            level: a.level,
            confidence: a.confidence,
            kb_refs: a.kbRefs,
            missing_info: a.missingInfo,
            needs_human: a.needsHuman,
            human_rule: a.humanRule,
            topics: a.topics,
            reply_len: a.reply.length,
          }),
          confidence: a.confidence,
          reason: a.reason || null,
          latencyMs: a.meta.latencyMs,
          tokensIn: a.meta.tokensIn,
          tokensOut: a.meta.tokensOut,
        },
      })
      .catch(() => undefined);
    return row;
  } catch (e) {
    console.error('[line-ai] 問い合わせ台帳の保存失敗:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 案件の承認待ち（最新1件） */
export async function findPendingByCase(caseNo: number): Promise<InquiryRow | null> {
  try {
    return await prisma.inquiry.findFirst({ where: { caseNo, status: 'pending' }, orderBy: { receivedAt: 'desc' } });
  } catch {
    return null;
  }
}

/** 送信済みにする（承認 or 書き換え）。書き換えなら修正データも残す */
export async function markSent(
  inquiry: InquiryRow,
  sentText: string,
  sentBy: string,
  opts: { edited?: boolean; userId?: string | null } = {},
): Promise<void> {
  try {
    await prisma.inquiry.update({
      where: { id: inquiry.id },
      data: { status: 'sent', sentText, sentBy, firstResponseAt: inquiry.firstResponseAt ?? new Date(), resolvedAt: new Date() },
    });
    if (opts.edited && inquiry.draft && inquiry.draft !== sentText) {
      await prisma.correction.create({
        data: { targetType: 'inquiry', targetId: inquiry.id, field: 'reply', before: inquiry.draft, after: sentText, userId: opts.userId ?? null },
      });
    }
  } catch (e) {
    console.error('[line-ai] 送信済み更新失敗:', e instanceof Error ? e.message : e);
  }
}

export async function markDismissed(inquiryId: string, userId: string | null): Promise<void> {
  try {
    await prisma.inquiry.update({ where: { id: inquiryId }, data: { status: 'dismissed', resolvedAt: new Date() } });
    await prisma.correction.create({ data: { targetType: 'inquiry', targetId: inquiryId, field: 'status', before: 'pending', after: 'dismissed', userId } });
  } catch (e) {
    console.error('[line-ai] 対応不要の更新失敗:', e instanceof Error ? e.message : e);
  }
}

/** 案件が完了したら、その案件の承認待ちを「対応不要」にする */
export async function dismissPendingOfCase(caseNo: number): Promise<number> {
  try {
    const r = await prisma.inquiry.updateMany({ where: { caseNo, status: 'pending' }, data: { status: 'dismissed', resolvedAt: new Date() } });
    return r.count;
  } catch {
    return 0;
  }
}

export type CsStats = {
  total: number;
  autoSent: number;
  staffSent: number;
  human: number;
  pending: number;
  autoRate: number | null;
  avgFirstResponseMin: number | null;
  byCategory: { code: string; count: number }[];
};

/** CS集計（期間内）。数字は台帳から機械的に出す（AIに計算させない） */
export async function csStats(since: Date): Promise<CsStats> {
  const rows = await prisma.inquiry.findMany({
    where: { receivedAt: { gte: since } },
    select: { status: true, action: true, categoryCode: true, receivedAt: true, firstResponseAt: true },
  });
  const total = rows.length;
  const autoSent = rows.filter((r) => r.status === 'auto_sent').length;
  const staffSent = rows.filter((r) => r.status === 'sent').length;
  const human = rows.filter((r) => r.action === 'human' || r.action === 'forwarded').length;
  const pending = rows.filter((r) => r.status === 'pending').length;
  const responded = rows.filter((r) => r.firstResponseAt);
  const avg = responded.length
    ? responded.reduce((s, r) => s + (r.firstResponseAt!.getTime() - r.receivedAt.getTime()), 0) / responded.length / 60000
    : null;
  const byMap = new Map<string, number>();
  for (const r of rows) byMap.set(r.categoryCode ?? 'other', (byMap.get(r.categoryCode ?? 'other') ?? 0) + 1);
  const byCategory = [...byMap.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
  return {
    total,
    autoSent,
    staffSent,
    human,
    pending,
    autoRate: total ? Math.round((autoSent / total) * 1000) / 10 : null,
    avgFirstResponseMin: avg == null ? null : Math.round(avg * 10) / 10,
    byCategory,
  };
}
