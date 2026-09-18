import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { generateAnswer } from '@/lib/line/answer';
import { replyText } from '@/lib/line/client';
import { loadKnowledge } from '@/lib/line/knowledge';
import { notifyStaff } from '@/lib/line/notify';
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
 * お客様のテキストメッセージに AI（Claude）が事実カードの範囲で自動返信し、
 * 要対応の場合はスタッフへ通知する。会話はダッシュボードの「LINE対応」画面で確認できる。
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
  return NextResponse.json({
    ok: true,
    endpoint: 'LINE webhook',
    configured: {
      channelSecret: Boolean((process.env.LINE_CHANNEL_SECRET || '').trim()),
      accessToken: Boolean((process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()),
      anthropic: Boolean((process.env.ANTHROPIC_API_KEY || '').trim()),
      staffNotify: Boolean((process.env.LINE_STAFF_GROUP_ID || process.env.CHATWORK_API_TOKEN || '').trim()),
    },
  });
}

async function handleEvent(ev: LineEvent): Promise<void> {
  // 再送イベントは replyToken が失効しているので返信しない（ログだけ残す判断は store 側）
  if (ev.deliveryContext?.isRedelivery) return;
  // グループ・複数人トークには反応しない（公式アカウントの1:1トークのみ）
  if (ev.source?.type && ev.source.type !== 'user') return;
  const userId = ev.source?.userId ?? '';
  const k = loadKnowledge();

  if (ev.type === 'follow' && ev.replyToken) {
    await replyText(ev.replyToken, k.bot.greeting);
    return;
  }

  if (ev.type !== 'message' || !ev.replyToken) return;
  if (ev.message?.type !== 'text') {
    // 画像・スタンプなどは担当者へ
    await replyText(ev.replyToken, k.bot.handoff);
    if (userId) {
      await saveReply(userId, k.bot.handoff, { needsHuman: true, reason: `テキスト以外（${ev.message?.type}）`, topics: [] });
      await notifyStaff({ lineUserId: userId, userText: `（${ev.message?.type ?? '不明'}メッセージ）`, reply: k.bot.handoff, reason: 'テキスト以外のメッセージ' });
    }
    return;
  }

  const text = (ev.message.text ?? '').trim();
  if (!text || !userId) return;

  const first = await claimEvent(ev.webhookEventId, userId, text);
  if (!first) return; // 二重配信

  const history = await loadHistory(userId, text);
  const ans = await generateAnswer(text, history);

  await replyText(ev.replyToken, ans.reply);
  await saveReply(userId, ans.reply, ans);

  if (ans.needsHuman) {
    await notifyStaff({ lineUserId: userId, userText: text, reply: ans.reply, reason: ans.reason });
  }
}
