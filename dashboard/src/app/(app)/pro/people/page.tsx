// PRO ⑨ 社員・組織: 部署ごとの一覧。閲覧範囲（一般社員は自チームのみ）は listPeople がサーバー側で絞る。
import { canSeeConfidential, requireActor } from '@/lib/rbac';
import { listPeople, teamOptions } from '@/lib/pro/people';
import { teamByCode } from '@/lib/pro/teams';
import PeopleDirectory from './PeopleDirectory';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requireActor();
  const res = await listPeople(actor);
  return (
    <PeopleDirectory
      people={res.people}
      today={res.today}
      teams={teamOptions()}
      taskSource={res.taskSource}
      taskNotice={res.taskNotice}
      companyWide={res.companyWide}
      scopedTeamName={res.scopedTeamCode ? (teamByCode(res.scopedTeamCode)?.name ?? res.scopedTeamCode) : null}
      canSeeConfidential={canSeeConfidential(actor.level)}
    />
  );
}
