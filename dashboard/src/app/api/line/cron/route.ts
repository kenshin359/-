// LINE監査役の定期処理（Vercel Cron → GET /api/line/cron、10分おき）
// - Authorization: Bearer ${CRON_SECRET} で保護。未設定なら 503（動いているふりをしない）
// - (a) 追いかけ: FollowUp(open, remindAt<=now) をグループへ push、回数+1、翌日同時刻に再設定（最大5回）
// - (b) 定時投稿: ScheduledPost の cron（JST）が直近15分以内に一致し、lastRunAt がその枠より前なら投稿
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { lineConfigured, pushMessage } from '@/lib/line/client';
import { shouldFire } from '@/lib/line/cron';
import { composePost, lineAudit, loadPostContext, runReminders } from '@/lib/line/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, reason: 'cron_secret_not_configured' }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  if (!lineConfigured()) {
    return NextResponse.json({ ok: false, reason: 'line_not_configured' }, { status: 200 });
  }

  const now = new Date();
  const out: Record<string, unknown> = { ok: true, at: now.toISOString() };

  // (a) 追いかけ
  try {
    out.reminders = await runReminders(now);
  } catch (e) {
    out.reminders = { error: e instanceof Error ? e.message : 'failed' };
  }

  // (b) 定時投稿
  const posts = await prisma.scheduledPost.findMany({ where: { active: true } });
  const groups = new Map(
    (await prisma.lineGroup.findMany({ where: { groupId: { in: [...new Set(posts.map((p) => p.groupId))] } } })).map((g) => [g.groupId, g]),
  );
  let ctx: Awaited<ReturnType<typeof loadPostContext>> | null = null;
  const fired: string[] = [];
  const skipped: string[] = [];
  for (const p of posts) {
    const { fire, slot } = shouldFire(p.cron, now, p.lastRunAt);
    if (!fire || !slot) continue;
    const g = groups.get(p.groupId);
    if (!g?.active) {
      skipped.push(`${p.id}:inactive_group`);
      continue;
    }
    // 先に lastRunAt を書いて、同じ枠での二重実行（並走した cron）を防ぐ
    const claimed = await prisma.scheduledPost.updateMany({
      where: { id: p.id, OR: [{ lastRunAt: null }, { lastRunAt: { lt: slot } }] },
      data: { lastRunAt: now },
    });
    if (claimed.count === 0) {
      skipped.push(`${p.id}:already_ran`);
      continue;
    }
    try {
      ctx ??= await loadPostContext(now);
      const text = await composePost(p, g, ctx);
      if (!text) {
        skipped.push(`${p.id}:empty`);
        await lineAudit('post.skip', `id=${p.id} 「${p.name}」 内容なし`);
        continue;
      }
      await pushMessage(p.groupId, [text]);
      await lineAudit('post.sent', `id=${p.id} 「${p.name}」 group=${p.groupId} template=${p.template} 文字数=${text.length}`);
      fired.push(p.id);
    } catch (e) {
      skipped.push(`${p.id}:error`);
      console.error(`[line] scheduled post failed id=${p.id} ${e instanceof Error ? e.message : ''}`);
      await lineAudit('post.error', `id=${p.id} 「${p.name}」 ${e instanceof Error ? e.message.slice(0, 120) : 'failed'}`);
    }
  }
  out.posts = { fired, skipped, total: posts.length };
  return NextResponse.json(out);
}
