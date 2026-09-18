// PRO KPI詳細: 30/90日の推移・値の記録・改善タスク（前後比較）。
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canWrite } from '@/lib/auth';
import { atLeast, requireActor } from '@/lib/rbac';
import { getKpi } from '@/lib/pro/kpi';
import { listTasks } from '@/lib/tasks';
import { KpiDetailView } from '../KpiView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'KPI詳細' };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const [actor, { code }] = await Promise.all([requireActor(), params]);
  const kpi = await getKpi(code);
  if (!kpi) notFound();
  const { options } = await listTasks();
  const write = canWrite(actor.role);
  return (
    <KpiDetailView
      kpi={kpi}
      options={options}
      canRecord={write && atLeast(actor.level, 'leader')}
      canManage={write && atLeast(actor.level, 'manager')}
      canCreateTask={write}
      defaultAssignee={actor.kintoneName ?? ''}
    />
  );
}
