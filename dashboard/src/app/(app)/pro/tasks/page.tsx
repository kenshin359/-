// PRO タスク2.0: ボトルネック（誰の仕事が止まっているか）・部署×状態・プロジェクト・一覧。
import type { Metadata } from 'next';
import { canWrite } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireActor } from '@/lib/rbac';
import { computeBottlenecks, listProjects, listTasks2, statusMatrix, STATUSES2, type Status2 } from '@/lib/pro/tasks2';
import { ensureKpiDefaults } from '@/lib/pro/kpi';
import Tasks2View, { type ListFilter, type Tab } from './Tasks2View';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'タスク2.0' };

const TABS: Tab[] = ['bottleneck', 'matrix', 'projects', 'list'];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; team?: string; status?: string; project?: string; assignee?: string }>;
}) {
  const [actor, params] = await Promise.all([requireActor(), searchParams]);
  await ensureKpiDefaults();
  const data = await listTasks2();
  const [projects, kpis, users] = await Promise.all([
    listProjects(data.tasks),
    prisma.kpi.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const now = new Date();
  const bottlenecks = computeBottlenecks(data.tasks, now);
  const matrix = statusMatrix(data.tasks);

  const tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : 'bottleneck';
  const initialFilter: Partial<ListFilter> = {
    teamKey: params.team || undefined,
    status: (STATUSES2 as readonly string[]).includes(params.status ?? '') ? (params.status as Status2) : undefined,
    projectCode: params.project || undefined,
    assignee: params.assignee || undefined,
  };

  return (
    <Tasks2View
      tasks={data.tasks}
      options={data.options}
      source={data.source}
      notice={data.notice}
      appId={data.appId}
      canEdit={canWrite(actor.role)}
      currentUserName={actor.kintoneName ?? actor.name}
      currentUserId={actor.id}
      bottlenecks={bottlenecks}
      matrix={matrix}
      projects={projects}
      kpiOptions={kpis}
      userOptions={users}
      initialTab={tab}
      initialFilter={initialFilter}
    />
  );
}
