// PRO 報告: 日報/週報/中間報告の器。?new=1 で作成フォームを開く（クイックアクションから）。
import type { Metadata } from 'next';
import { canWrite } from '@/lib/auth';
import { atLeast, canSeeCompanyWide, requireActor } from '@/lib/rbac';
import { listReports, REPORT_TYPES, type ReportType } from '@/lib/pro/reports';
import ReportsView from './ReportsView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '報告' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; team?: string; type?: string; from?: string; to?: string; id?: string }>;
}) {
  const [actor, params] = await Promise.all([requireActor(), searchParams]);
  const companyWide = canSeeCompanyWide(actor.level);
  const type = (REPORT_TYPES as readonly string[]).includes(params.type ?? '') ? (params.type as ReportType) : undefined;
  const reports = await listReports({
    teamCode: params.team || undefined,
    type,
    from: params.from || undefined,
    to: params.to || undefined,
    // 一般社員は自分と自チームの報告だけ（サーバー側で絞る）
    visibleAuthorId: companyWide ? undefined : actor.id,
    visibleTeamCode: companyWide ? undefined : actor.teamCode,
  });
  const write = canWrite(actor.role);
  return (
    <ReportsView
      reports={reports}
      actor={{ id: actor.id, name: actor.name, teamCode: actor.teamCode, isAdmin: actor.role === 'admin' }}
      canWrite={write}
      canReview={write && atLeast(actor.level, 'leader')}
      canGenerate={write && atLeast(actor.level, 'manager')}
      openNew={params.new === '1'}
      openId={params.id || null}
      initialFilter={{ teamCode: params.team ?? '', type: params.type ?? '', from: params.from ?? '', to: params.to ?? '' }}
    />
  );
}
