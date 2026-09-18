// PRO ② 部署一覧（会社 → 部署）。カードは「未完了・期限超過・確認待ち滞留・今週期限・最新報告」。
// 一般社員（staff）はサーバー側で自部署のカードだけに絞る（他部署は返さない）。
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, Database, Hourglass, NotebookPen } from 'lucide-react';
import { Notice, EmptyState } from '@/components/ui';
import { canSeeCompanyWide, requireActor } from '@/lib/rbac';
import { listTeamsSummary, ownTeamCodeFor, WAITING_STALE_DAYS, WEEK_AHEAD_DAYS, type TeamSummary } from '@/lib/pro/team-dashboard';
import { fmtDateShortJa } from '@/lib/pro/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '部署' };

const REPORT_TYPE_JA: Record<string, string> = { daily: '日報', weekly: '週報', interim: '中間報告' };

export default async function TeamsPage() {
  const actor = await requireActor();
  const companyWide = canSeeCompanyWide(actor.level);
  const result = await listTeamsSummary();
  const ownCode = ownTeamCodeFor(actor);
  const teams = companyWide ? result.teams : result.teams.filter((t) => t.code === ownCode);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">部署</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {companyWide ? '会社 → 部署 → 担当者。' : '所属部署の状況。'}
            期限超過・確認待ち滞留（{WAITING_STALE_DAYS}日超）・{WEEK_AHEAD_DAYS}日以内の期限を部署ごとに。
          </p>
        </div>
        <SourceBadge source={result.source} />
      </header>

      {result.notice && (
        <Notice tone={result.source === 'local' ? 'warn' : 'info'}>
          {result.notice}
        </Notice>
      )}

      {teams.length === 0 ? (
        <EmptyState
          title={companyWide ? '部署がありません' : '所属部署が未設定です'}
          body={
            companyWide
              ? '部署定義（src/lib/pro/teams.ts）または Team テーブルを確認してください。'
              : '所属部署と担当者名が設定されると、自分の部署の状況がここに出ます。管理者に PRO設定（社員・組織）での設定を依頼してください。'
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => (
            <li key={t.code}>
              <TeamCard t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: 'kintone' | 'local' }) {
  const ok = source === 'kintone';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <Database size={12} aria-hidden />
      {ok ? 'Kintone タスク管理と同期中' : '未接続: このDBのタスク'}
    </span>
  );
}

function TeamCard({ t }: { t: TeamSummary }) {
  const noLabel = t.kintoneLabels.length === 0;
  const overdueTone = t.overdue > 0 ? 'text-red-700' : 'text-slate-900';
  const staleTone = t.waitingStale > 0 ? 'text-amber-800' : 'text-slate-900';
  const border = t.overdue > 0 ? 'border-red-200' : t.waitingStale > 0 ? 'border-amber-200' : 'border-slate-200';
  return (
    <Link
      href={`/pro/teams/${t.code}`}
      className={`rise-in block h-full rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${border}`}
      aria-label={`${t.name} の部署ダッシュボードを開く`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {t.parentName && <p className="truncate text-[10px] text-slate-400">{t.parentName}</p>}
          <h2 className="truncate text-sm font-bold text-slate-900">{t.name}</h2>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            責任者 {t.leader ?? '未設定'}・{t.members.length}人
          </p>
        </div>
        <ChevronRight size={16} aria-hidden className="mt-1 shrink-0 text-slate-400" />
      </div>

      {noLabel ? (
        <p className="mt-3 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] leading-relaxed text-slate-500">
          Kintoneタスク管理に対応するチーム選択肢が無いため、タスク集計は未対応です
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-4 gap-1 text-center">
          <Cell label="未完了" n={t.open} tone="text-slate-900" />
          <Cell label="期限超過" n={t.overdue} tone={overdueTone} icon={t.overdue > 0 ? <AlertTriangle size={11} aria-hidden /> : undefined} />
          <Cell label="滞留" n={t.waitingStale} tone={staleTone} icon={t.waitingStale > 0 ? <Hourglass size={11} aria-hidden /> : undefined} />
          <Cell label={`${WEEK_AHEAD_DAYS}日以内`} n={t.dueThisWeek} tone="text-slate-900" />
        </dl>
      )}

      <p className="mt-3 inline-flex items-center gap-1 text-[11px] text-slate-500">
        <NotebookPen size={11} aria-hidden />
        {t.latestReport ? (
          <>
            最新報告 {fmtDateShortJa(t.latestReport.createdAt)}・{REPORT_TYPE_JA[t.latestReport.type] ?? t.latestReport.type}
          </>
        ) : (
          '報告はまだありません'
        )}
      </p>
    </Link>
  );
}

function Cell({ label, n, tone, icon }: { label: string; n: number; tone: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md bg-slate-50 px-1 py-1.5">
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className={`tabular inline-flex items-center gap-0.5 text-base font-bold leading-tight ${tone}`}>
        {icon}
        {n}
      </dd>
    </div>
  );
}
