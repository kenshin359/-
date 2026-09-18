// PRO ④ 今日やること（本人向け・スマホ幅優先）。
// 期限超過 → 本日期限 → 確認待ち → 上司からの依頼 → P1 → 期限3日以内 の順に、ワンタップで状態を変える。
import type { Metadata } from 'next';
import { requireActor } from '@/lib/rbac';
import { canWrite } from '@/lib/auth';
import { getTodayFor } from '@/lib/pro/today';
import TodayView from './TodayView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '今日やること' };

export default async function TodayPage() {
  const actor = await requireActor();
  const data = await getTodayFor(actor);
  return <TodayView data={data} actorName={actor.name} hasKintoneName={!!actor.kintoneName} canEdit={canWrite(actor.role)} />;
}
