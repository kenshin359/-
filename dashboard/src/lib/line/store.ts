import { prisma } from '@/lib/prisma';
import type { HistoryTurn } from './answer';

/** 直近の文脈として AI に渡す件数と期間 */
const HISTORY_LIMIT = 10;
const HISTORY_HOURS = 24;

/**
 * 同じ Webhook イベントを二重処理しないための記録。
 * 既に処理済みなら false（LINE は失敗時に同じ webhookEventId で再送してくる）。
 */
export async function claimEvent(eventId: string | undefined, lineUserId: string, text: string): Promise<boolean> {
  try {
    await prisma.lineChatLog.create({
      data: { eventId: eventId || undefined, lineUserId, direction: 'in', text },
    });
    return true;
  } catch (e) {
    // eventId の一意制約違反 = 処理済み
    const code = (e as { code?: string })?.code;
    if (code === 'P2002') return false;
    console.error('[line-ai] 受信ログ保存失敗:', e instanceof Error ? e.message : e);
    return true; // ログが書けなくても返信は止めない
  }
}

export async function saveReply(
  lineUserId: string,
  text: string,
  meta: { needsHuman: boolean; reason: string; topics: string[] },
): Promise<void> {
  try {
    await prisma.lineChatLog.create({
      data: {
        lineUserId,
        direction: 'out',
        text,
        needsHuman: meta.needsHuman,
        reason: meta.reason || null,
        topics: meta.topics.length ? meta.topics.join(',') : null,
      },
    });
  } catch (e) {
    console.error('[line-ai] 返信ログ保存失敗:', e instanceof Error ? e.message : e);
  }
}

/** 直近の会話（今回の受信より前）を古い順で返す */
export async function loadHistory(lineUserId: string, beforeText: string): Promise<HistoryTurn[]> {
  try {
    const since = new Date(Date.now() - HISTORY_HOURS * 3600 * 1000);
    const rows = await prisma.lineChatLog.findMany({
      where: { lineUserId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT + 1,
    });
    const turns = rows
      .reverse()
      .map((r) => ({ role: r.direction === 'in' ? 'user' : 'assistant', text: r.text }) as HistoryTurn);
    // 直前に保存した今回の受信分は除く
    if (turns.length && turns[turns.length - 1].role === 'user' && turns[turns.length - 1].text === beforeText) {
      turns.pop();
    }
    // 先頭は user から始める（API の制約）
    while (turns.length && turns[0].role !== 'user') turns.shift();
    return turns.slice(-HISTORY_LIMIT);
  } catch (e) {
    console.error('[line-ai] 履歴取得失敗:', e instanceof Error ? e.message : e);
    return [];
  }
}
