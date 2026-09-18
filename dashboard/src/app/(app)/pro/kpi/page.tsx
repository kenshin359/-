// PRO KPI一覧: 判定（🟢🟡🔴）・最新値・推移・改善タスク数。閾値は docs/business.md §6 の現場基準。
import type { Metadata } from 'next';
import { canWrite } from '@/lib/auth';
import { atLeast, requireActor } from '@/lib/rbac';
import { listKpis } from '@/lib/pro/kpi';
import { KpiList } from './KpiView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'KPI' };

export default async function Page() {
  const actor = await requireActor();
  const kpis = await listKpis();
  return <KpiList kpis={kpis} canManage={atLeast(actor.level, 'manager') && canWrite(actor.role)} />;
}
