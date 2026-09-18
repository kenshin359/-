// PRO: LINE監査役（グループ・抽出された依頼・追いかけ状況・定時投稿・監査ログ）
// 閲覧はリーダー以上。メッセージ本文と操作は管理職以上（サーバー側で落とす）。
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requireActor, atLeast } from '@/lib/rbac';
import { Notice } from '@/components/ui';
import { lineConfigured, LINE_ENV_NAMES } from '@/lib/line/client';
import { nextMatch } from '@/lib/line/cron';
import { jstDateKey } from '@/lib/metrics/format';
import { TEAM_DEFS, teamByCode } from '@/lib/pro/teams';
import { listTasks } from '@/lib/tasks';
import { MEMBERS, TEAMS } from '@/lib/tasks-constants';
import LineAdmin from './LineAdmin';
import type { AuditView, FollowUpView, LineAdminData, LineGroupView, LineMessageView, ScheduledPostView } from './types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'LINE監査役' };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export default async function Page() {
  const actor = await requireActor();
  if (!atLeast(actor.level, 'leader')) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-bold text-slate-900">LINE監査役</h1>
        <Notice tone="info">この画面はリーダー以上が閲覧できます。自分宛の追いかけは「今日やること」に表示されます。</Notice>
      </div>
    );
  }
  const canManage = atLeast(actor.level, 'manager');
  const now = new Date();

  const [groups, msgs, followUps, posts, audits, taskOpts] = await Promise.all([
    prisma.lineGroup.findMany({ orderBy: [{ active: 'desc' }, { joinedAt: 'desc' }] }),
    prisma.lineMessage.findMany({ orderBy: { ts: 'desc' }, take: 300 }),
    prisma.followUp.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 300, include: { source: { select: { text: true } } } }),
    prisma.scheduledPost.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.auditLog.findMany({ where: { action: { startsWith: 'line.' } }, orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { name: true } } } }),
    // タスク化の選択肢（Kintone のドロップダウンがあればそれ）。取れなければ定数
    listTasks().catch(() => null),
  ]);

  const groupMap = new Map(groups.map((g) => [g.groupId, g]));
  const counts = new Map<string, { count: number; last: Date | null }>();
  for (const m of msgs) {
    const c = counts.get(m.groupId) ?? { count: 0, last: null };
    c.count++;
    if (!c.last || m.ts > c.last) c.last = m.ts;
    counts.set(m.groupId, c);
  }
  // 300件より前も数える
  const totals = await prisma.lineMessage.groupBy({ by: ['groupId'], _count: { _all: true } });
  const totalMap = new Map(totals.map((t) => [t.groupId, t._count._all]));
  const openCounts = new Map<string, number>();
  for (const f of followUps) if (f.status === 'open' && f.groupId) openCounts.set(f.groupId, (openCounts.get(f.groupId) ?? 0) + 1);

  const groupViews: LineGroupView[] = groups.map((g) => ({
    groupId: g.groupId,
    name: g.name,
    teamCode: g.teamCode,
    teamName: g.teamCode ? teamByCode(g.teamCode)?.name ?? g.teamCode : null,
    active: g.active,
    joinedAt: g.joinedAt.toISOString(),
    messageCount: totalMap.get(g.groupId) ?? counts.get(g.groupId)?.count ?? 0,
    lastMessageAt: iso(counts.get(g.groupId)?.last ?? null),
    openFollowUps: openCounts.get(g.groupId) ?? 0,
  }));

  const messageViews: LineMessageView[] = msgs.map((m) => {
    let extracted: LineMessageView['extracted'] = null;
    if (m.extractedJson) {
      try {
        const j = JSON.parse(m.extractedJson) as { extracted?: { confidence?: string; title?: string }; completion?: boolean; followUpId?: string };
        extracted = { confidence: j.extracted?.confidence, title: j.extracted?.title, completion: j.completion, followUpId: j.followUpId };
      } catch {
        extracted = null;
      }
    }
    return {
      id: m.id,
      groupId: m.groupId,
      displayName: m.displayName,
      kind: m.kind,
      text: canManage ? m.text : null,
      ts: m.ts.toISOString(),
      extracted,
    };
  });

  const followUpViews: FollowUpView[] = followUps.map((f) => ({
    id: f.id,
    groupId: f.groupId,
    groupName: f.groupId ? groupMap.get(f.groupId)?.name ?? null : null,
    teamCode: f.groupId ? groupMap.get(f.groupId)?.teamCode ?? null : null,
    title: f.title,
    assigneeName: f.assigneeName,
    due: f.due ? jstDateKey(f.due) : null,
    status: f.status,
    taskId: f.taskId,
    remindAt: iso(f.remindAt),
    remindedCount: f.remindedCount,
    lastRemindedAt: iso(f.lastRemindedAt),
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    sourceText: canManage ? f.source?.text ?? null : null,
  }));

  const postViews: ScheduledPostView[] = posts.map((p) => ({
    id: p.id,
    groupId: p.groupId,
    groupName: groupMap.get(p.groupId)?.name ?? null,
    name: p.name,
    cron: p.cron,
    template: p.template,
    body: p.body,
    active: p.active,
    lastRunAt: iso(p.lastRunAt),
    nextRunAt: p.active ? iso(nextMatch(p.cron, now)) : null,
  }));

  const auditViews: AuditView[] = audits.map((a) => ({
    id: a.id,
    action: a.action,
    detail: a.detail,
    createdAt: a.createdAt.toISOString(),
    userName: a.user?.name ?? null,
  }));

  const data: LineAdminData = {
    configured: lineConfigured(),
    envNames: LINE_ENV_NAMES,
    cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    canManage,
    groups: groupViews,
    messages: messageViews,
    followUps: followUpViews,
    posts: postViews,
    audits: auditViews,
    teamOptions: TEAM_DEFS.map((t) => ({ code: t.code, name: t.name, kintoneLabel: t.kintoneLabels[0] ?? null })),
    taskTeams: taskOpts?.options.teams ?? TEAMS,
    members: taskOpts?.options.members ?? MEMBERS,
    tasksNotice: taskOpts?.notice ?? null,
    now: now.toISOString(),
  };

  return <LineAdmin data={data} />;
}
