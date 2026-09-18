import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { generateAnswer } from '@/lib/line/answer';
import { findOpenCase, openOrTouchCase } from '@/lib/line/cases';
import { replyText } from '@/lib/line/client';
import { handleGroupEvent } from '@/lib/line/group';
import { loadKnowledge } from '@/lib/line/knowledge';
import { notifyStaff } from '@/lib/line/notify';
import { getStaffGroupId } from '@/lib/line/settings';
import { verifyLineSignature } from '@/lib/line/signature';
import { claimEvent, loadHistory, saveReply } from '@/lib/line/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type LineEvent = {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  deliveryContext?: { isRedelivery?: boolean };
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  message?: { type?: string; id?: string; text?: string };
};

/**
 * LINE公式アカウント（Messaging API）の Webhook。
 *
 * 1:1トーク（お客様）: AI（Claude）が事実カードの範囲で自動返信。要対応なら案件番号を付けてスタッフグループへ通知。
 *   案件が進行中（スタッフ対応中）の間はAI返信を止め、お客様のメッセージをグループへ転送する。
 * グループ（スタッフ）: 招待されると通知先として自動登録。「#番号 返信文」でお客様へ返信、「完了 #番号」でAI再開。
 *
 * LINE Developers の Webhook URL: https://<ダッシュボードのドメイン>/api/line/webhook
 */
export async function POST(req: Request) {
  const secret = (process.env.LINE_CHANNEL_SECRET || '').trim();
  if (!secret) {
    return NextResponse.json({ error: 'LINE_CHANNEL_SECRET が未設定です' }, { status: 503 });
  }
  const raw = await req.text();
  if (!verifyLineSignature(secret, raw, req.headers.get('x-line-signature'))) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw || '{}').events ?? []) as LineEvent[];
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // LINE には即座に 200 を返し、返信処理は after() で続行する（replyToken は約1分有効）
  after(async () => {
    for (const ev of events) {
      try {
        await handleEvent(ev);
      } catch (e) {
        console.error('[line-ai] イベント処理失敗:', e instanceof Error ? e.message : e);
      }
    }
  });
  return NextResponse.json({ ok: true, received: events.length });
}

/** 疎通確認用（ブラウザで開いたとき） */
export async function GET() {
  const staffGroup = await getStaffGroupId();
  return NextResponse.json({
    ok: true,
    endpoint: 'LINE webhook',
    configured: {
      channelSecret: Boolean((process.env.LINE_CHANNEL_SECRET || '').trim()),
      accessToken: Boolean((process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()),
      anthropic: Boolean((process.env.ANTHROPIC_API_KEY || '').trim()),
      staffGroup: Boolean(staffGroup),
      chatwork: Boolean((process.env.CHATWORK_API_TOKEN || '').trim()),
    },
  });
}

async function handleEvent(ev: LineEvent): Promise<void> {
  // 再送イベントは replyToken が失効しているので返信しない
  if (ev.deliveryContext?.isRedelivery) return;

  // グループ・複数人トーク = スタッフ側
  if (ev.source?.type === 'group' || ev.source?.type === 'room') {
    await handleGroupEvent(ev);
    return;
  }

  const userId = ev.source?.userId ?? '';
  const k = loadKnowledge();

  if (ev.type === 'follow' && ev.replyToken) {
    await replyText(ev.replyToken, k.bot.greeting);
    return;
  }

  if (ev.type !== 'message' || !ev.replyToken || !userId) return;

  if (ev.message?.type !== 'text') {
    // 画像・スタンプなどは担当者へ
    const label = `（${ev.message?.type ?? '不明'}メッセージ）`;
    const c = await openOrTouchCase(userId, label, 'テキスト以外のメッセージ');
    await replyText(ev.replyToken, k.bot.handoff);
    await saveReply(userId, k.bot.handoff, { needsHuman: true, reason: `テキスト以外（${ev.message?.type}）`, topics: [] });
    await notifyStaff({ caseNo: c?.no ?? null, lineUserId: userId, userText: label, reply: k.bot.handoff, reason: 'テキスト以外のメッセージ' });
    return;
  }

  const text = (ev.message.text ?? '').trim();
  if (!text) return;

  const first = await claimEvent(ev.webhookEventId, userId, text);
  if (!first) return; // 二重配信

  // スタッフ対応中の案件があれば、AIは黙ってグループへ転送する
  const open = await findOpenCase(userId);
  if (open) {
    await openOrTouchCase(userId, text, open.reason ?? '');
    await notifyStaff({ caseNo: open.no, lineUserId: userId, userText: text, reply: null, reason: open.reason ?? '', followUp: true });
    return;
  }

  const history = await loadHistory(userId, text);
  const ans = await generateAnswer(text, history);

  // 返信の送信に失敗しても（トークン失効など）案件化とスタッフ通知は必ず行う
  let needsHuman = ans.needsHuman;
  let reason = ans.reason;
  let sentReply: string | null = ans.reply;
  try {
    await replyText(ev.replyToken, ans.reply);
    await saveReply(userId, ans.reply, ans);
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : String(e);
    console.error('[line-ai] お客様への返信失敗:', msg);
    needsHuman = true;
    reason = [`返信送信失敗: ${msg}`, reason].filter(Boolean).join(' / ');
    sentReply = null;
  }

  if (needsHuman) {
    const c = await openOrTouchCase(userId, text, reason);
    await notifyStaff({ caseNo: c?.no ?? null, lineUserId: userId, userText: text, reply: sentReply, reason });
  }
}
