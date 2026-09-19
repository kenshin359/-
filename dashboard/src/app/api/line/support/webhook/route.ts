import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { generateAnswer } from '@/lib/line-support/answer';
import { findOpenCase, openOrTouchCase } from '@/lib/line-support/cases';
import { findCategory, loadCategories } from '@/lib/line-support/categories';
import { recordInquiry } from '@/lib/line-support/inquiries';
import { decideAction, loadPolicy } from '@/lib/line-support/policy';
import { replyText } from '@/lib/line-support/client';
import { handleGroupEvent } from '@/lib/line-support/group';
import { loadKnowledge } from '@/lib/line-support/knowledge';
import { notifyStaff } from '@/lib/line-support/notify';
import { getStaffGroupId } from '@/lib/line-support/settings';
import { verifyLineSignature } from '@/lib/line-support/signature';
import { claimEvent, loadHistory, saveReply } from '@/lib/line-support/store';

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
 * 1:1トーク（お客様）: AI（Claude）が分類・レベル・確信度と回答案を作り、カテゴリの運用モードで分岐する。
 *   AUTO=条件を満たせば自動返信／APPROVAL=受付文を返し回答案をスタッフグループへ（「#番号 送信」で送信）／HUMAN_ONLY=引き継ぎ文＋案件化。
 *   案件が進行中（スタッフ対応中）の間はAI返信を止め、お客様のメッセージをグループへ転送する。
 * グループ（スタッフ）: 招待されると通知先として自動登録。「#番号 返信文」でお客様へ返信、「完了 #番号」でAI再開。
 *
 * LINE Developers の Webhook URL: https://<ダッシュボードのドメイン>/api/line/support/webhook
 */
export async function POST(req: Request) {
  const secret = (process.env.LINE_SUPPORT_CHANNEL_SECRET || '').trim();
  if (!secret) {
    return NextResponse.json({ error: 'LINE_SUPPORT_CHANNEL_SECRET が未設定です' }, { status: 503 });
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
      channelSecret: Boolean((process.env.LINE_SUPPORT_CHANNEL_SECRET || '').trim()),
      accessToken: Boolean((process.env.LINE_SUPPORT_CHANNEL_ACCESS_TOKEN || '').trim()),
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

  if (ev.type === 'follow') {
    // 友だち追加時の挨拶は既定で LINE 公式アカウント側の「あいさつメッセージ」に任せる（二重送信を防ぐ）。
    // LINE側をオフにして AI 側の文面（bot.greeting）を使う場合だけ greeting_by_bot を true にする。
    if (k.bot.greeting_by_bot && ev.replyToken) await replyText(ev.replyToken, k.bot.greeting);
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
  const [categories, policy] = await Promise.all([loadCategories(), loadPolicy()]);
  const ans = await generateAnswer(text, history, { categories });
  const cat = findCategory(categories, ans.categoryCode);
  const action = decideAction({
    mode: cat.mode,
    level: ans.level,
    confidence: ans.confidence,
    humanRule: ans.humanRule || ans.source === 'fallback',
    kbRefs: ans.kbRefs,
    policy,
  });
  const classification = `${cat.name}（L${ans.level}・確信度${ans.confidence}）`;

  // お客様へ即時に返す本文: 自動返信ならAIの回答、承認待ちなら受付文、有人なら引き継ぎ文
  const immediate = action === 'auto_reply' ? ans.reply : action === 'approval' ? k.bot.ack : ans.source === 'fallback' ? ans.reply : k.bot.handoff;
  let sendFailed: string | null = null;
  try {
    await replyText(ev.replyToken, immediate);
    await saveReply(userId, immediate, {
      needsHuman: action !== 'auto_reply',
      reason: action === 'auto_reply' ? `自動返信（${classification}）` : `${action === 'approval' ? '受付文' : '引き継ぎ文'}（${classification}）`,
      topics: ans.topics,
    });
  } catch (e) {
    sendFailed = e instanceof Error ? e.message.slice(0, 160) : String(e);
    console.error('[line-ai] お客様への返信失敗:', sendFailed);
  }
  const reason = [sendFailed ? `返信送信失敗: ${sendFailed}` : '', ans.reason].filter(Boolean).join(' / ');

  if (action === 'auto_reply' && !sendFailed) {
    await recordInquiry({ lineUserId: userId, caseNo: null, userText: text, answer: ans, mode: cat.mode, action, status: 'auto_sent', sentText: ans.reply, sentBy: 'ai', firstResponseAt: new Date() });
    return;
  }

  // 承認待ち・有人・送信失敗 → 案件化してスタッフへ
  const c = await openOrTouchCase(userId, text, reason || classification);
  const status = action === 'approval' ? 'pending' : 'handed_off';
  await recordInquiry({ lineUserId: userId, caseNo: c?.no ?? null, userText: text, answer: ans, mode: cat.mode, action: sendFailed && action === 'auto_reply' ? 'approval' : action, status: sendFailed && action === 'auto_reply' ? 'pending' : status });
  await notifyStaff({
    caseNo: c?.no ?? null,
    lineUserId: userId,
    userText: text,
    reply: sendFailed ? null : immediate,
    reason: reason || classification,
    classification,
    draft: action === 'human' && ans.source !== 'fallback' ? null : ans.source === 'ai' ? ans.reply : null,
    kbRefs: ans.kbRefs,
    missingInfo: ans.missingInfo,
  });
}
