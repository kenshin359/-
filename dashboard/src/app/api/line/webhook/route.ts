// LINE Messaging API Webhook（監査役ボット）
// - 生ボディで X-Line-Signature を検証（不一致は 401）。環境変数が無ければ 200 {ok:false, reason:'not_configured'}（落とさない）
// - join → LineGroup を有効化して挨拶、leave → 無効化、group/room のテキスト → 保存→抽出→FollowUp／完了照合
// - 同じ message id の再配信は二重処理しない。ログには ID と文字数のみ（本文・トークンは出さない）
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getGroupMemberProfile, getGroupSummary, lineConfigured, replyMessage, verifySignature } from '@/lib/line/client';
import { lineAudit, processIncomingText } from '@/lib/line/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LineSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}
interface LineEvent {
  type: string;
  timestamp?: number;
  replyToken?: string;
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
  source?: LineSource;
  message?: { id: string; type: string; text?: string; quotedMessageId?: string };
}

const JOIN_TEXT =
  '監査役が参加しました。\nこのグループの「〜お願いします」「〜までに」などの依頼・約束を記録し、期限が来たら追いかけます。\n完了したら「完了しました」と返信してください。';

function groupIdOf(src?: LineSource): string | null {
  if (!src) return null;
  if (src.type === 'group' && src.groupId) return src.groupId;
  if (src.type === 'room' && src.roomId) return src.roomId;
  return null;
}

async function ensureGroup(groupId: string, fetchName: boolean): Promise<void> {
  const existing = await prisma.lineGroup.findUnique({ where: { groupId } });
  if (existing?.active && existing.name) return;
  const name = fetchName || !existing?.name ? (await getGroupSummary(groupId))?.groupName ?? existing?.name ?? null : existing.name;
  await prisma.lineGroup.upsert({
    where: { groupId },
    create: { groupId, name, active: true },
    update: { active: true, ...(name ? { name } : {}) },
  });
}

async function handleEvent(ev: LineEvent, now: Date): Promise<string> {
  const groupId = groupIdOf(ev.source);

  if (ev.type === 'join' && groupId) {
    await ensureGroup(groupId, true);
    await lineAudit('group.join', `group=${groupId}`);
    if (ev.replyToken) await replyMessage(ev.replyToken, [JOIN_TEXT]);
    return 'join';
  }

  if (ev.type === 'leave' && groupId) {
    await prisma.lineGroup.updateMany({ where: { groupId }, data: { active: false } });
    await lineAudit('group.leave', `group=${groupId}`);
    return 'leave';
  }

  if (ev.type === 'message' && ev.message && groupId) {
    if (ev.message.type !== 'text' || typeof ev.message.text !== 'string') {
      // 画像・スタンプ等は件数だけ残す（本文なし）
      await ensureGroup(groupId, false);
      await prisma.lineMessage
        .create({
          data: {
            groupId,
            lineMessageId: ev.message.id,
            userId: ev.source?.userId ?? null,
            kind: ev.message.type || 'other',
            ts: new Date(ev.timestamp ?? now.getTime()),
            processedAt: now,
          },
        })
        .catch(() => undefined); // 再配信の一意制約違反は無視
      return 'message.other';
    }
    await ensureGroup(groupId, false);
    const userId = ev.source?.userId ?? null;
    const profile = userId ? await getGroupMemberProfile(groupId, userId) : null;
    const r = await processIncomingText(
      {
        groupId,
        lineMessageId: ev.message.id,
        userId,
        displayName: profile?.displayName ?? null,
        text: ev.message.text,
        ts: new Date(ev.timestamp ?? now.getTime()),
        quotedLineMessageId: ev.message.quotedMessageId ?? null,
      },
      now,
    );
    console.log(
      `[line] message id=${ev.message.id} group=${groupId.slice(0, 6)}… len=${ev.message.text.length} dup=${r.duplicate} followUp=${r.followUpId ?? '-'} done=${r.completedFollowUpId ?? '-'}`,
    );
    // 返信（依頼を記録したとき／完了を受け付けたとき）。再配信時は replyToken が失効しているので送らない
    if (ev.replyToken && !r.duplicate && !ev.deliveryContext?.isRedelivery) {
      if (r.completedFollowUpId) {
        await replyMessage(ev.replyToken, ['✅ 完了として記録しました。お疲れさまです。']);
      } else if (r.followUpId && r.extracted) {
        const who = r.extracted.assigneeName ? `担当: ${r.extracted.assigneeName}` : '担当: 未定';
        const due = r.extracted.due ? `期限: ${r.extracted.due.slice(5).replace('-', '/')}` : '期限: なし（3日後に確認）';
        await replyMessage(ev.replyToken, [`📝 記録しました: ${r.extracted.title}（${who}・${due}）`]);
      }
    }
    return r.duplicate ? 'message.dup' : 'message.text';
  }

  return `skip:${ev.type}`;
}

export async function POST(req: Request) {
  if (!lineConfigured()) {
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 200 });
  }
  const raw = await req.text();
  const signature = req.headers.get('x-line-signature');
  if (!verifySignature(raw, signature)) {
    console.warn(`[line] signature mismatch len=${raw.length}`);
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 401 });
  }

  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(raw) as { events?: LineEvent[] };
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }
  const events = Array.isArray(body.events) ? body.events : [];
  const now = new Date();
  const handled: string[] = [];
  for (const ev of events) {
    try {
      handled.push(await handleEvent(ev, now));
    } catch (e) {
      // 1件の失敗で他を止めない。LINE には 200 を返し、再配信に備える
      console.error(`[line] event failed type=${ev.type} id=${ev.webhookEventId ?? '-'} ${e instanceof Error ? e.message : ''}`);
      handled.push(`error:${ev.type}`);
    }
  }
  return NextResponse.json({ ok: true, handled });
}

export async function GET() {
  // LINE Developers の「検証」ボタンや死活確認用（設定状態だけ返す。秘密は返さない）
  return NextResponse.json({ ok: true, configured: lineConfigured() });
}
