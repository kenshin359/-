import { prisma } from '@/lib/prisma';

/** スタッフが「完了」を忘れても、この時間だけ動きが無ければ案件は自動的に閉じたものとして扱い、AI自動返信を再開する */
export const CASE_STALE_HOURS = 48;

export type LineCaseRow = {
  no: number;
  lineUserId: string;
  status: string;
  lastUserText: string;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

function staleBefore(): Date {
  return new Date(Date.now() - CASE_STALE_HOURS * 3600 * 1000);
}

/** お客様の進行中案件（48時間以内に動きがあるもの） */
export async function findOpenCase(lineUserId: string): Promise<LineCaseRow | null> {
  try {
    return await prisma.lineCase.findFirst({
      where: { lineUserId, status: 'open', updatedAt: { gte: staleBefore() } },
      orderBy: { no: 'desc' },
    });
  } catch (e) {
    console.error('[line-ai] 案件取得失敗:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 進行中案件があれば更新、無ければ新規作成して返す */
export async function openOrTouchCase(lineUserId: string, userText: string, reason: string): Promise<LineCaseRow | null> {
  try {
    const existing = await findOpenCase(lineUserId);
    if (existing) {
      return await prisma.lineCase.update({
        where: { no: existing.no },
        data: { lastUserText: userText, reason: reason || existing.reason },
      });
    }
    return await prisma.lineCase.create({ data: { lineUserId, lastUserText: userText, reason: reason || null } });
  } catch (e) {
    console.error('[line-ai] 案件作成失敗:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getCase(no: number): Promise<LineCaseRow | null> {
  try {
    return await prisma.lineCase.findUnique({ where: { no } });
  } catch {
    return null;
  }
}

export async function touchCase(no: number): Promise<void> {
  try {
    await prisma.lineCase.update({ where: { no }, data: { updatedAt: new Date() } });
  } catch {
    /* 任意 */
  }
}

export async function closeCase(no: number): Promise<LineCaseRow | null> {
  try {
    return await prisma.lineCase.update({ where: { no }, data: { status: 'done', closedAt: new Date() } });
  } catch {
    return null;
  }
}

export async function listOpenCases(limit = 20): Promise<LineCaseRow[]> {
  try {
    return await prisma.lineCase.findMany({
      where: { status: 'open', updatedAt: { gte: staleBefore() } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  } catch {
    return [];
  }
}
