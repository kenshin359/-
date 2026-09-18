// PRO ホーム: 経営ダッシュボード。会社の状態が 5〜10秒で分かること（KPIタイル11枚・判断事項・部署カード）。
// 数字はすべて src/lib/pro/overview.ts から。未接続・未取得は隠さず表示する。リーダー以上のみ（一般社員は /pro/today へ）。
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowRight, Bell, Building2, Database } from 'lucide-react';
import { Notice } from '@/components/ui';
import { canSeeCompanyWide, requireActor } from '@/lib/rbac';
import { getCompanyOverview, type Decision, type Judgment, type KpiTile, type TeamCard } from '@/lib/pro/overview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '経営ダッシュボード' };

const DOT: Record<Judgment, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-red-500',
  na: 'bg-slate-300',
};
const JUDGE_JA: Record<Judgment, string> = { ok: '正常', warn: '注意', danger: '危険', na: '判定なし' };

function Tile({ t }: { t: KpiTile }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium leading-snug text-slate-500">{t.label}</p>
        <span
          className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[t.judgment]}`}
          role="img"
          aria-label={JUDGE_JA[t.judgment]}
          title={JUDGE_JA[t.judgment]}
        />
      </div>
      <p className={`tabular mt-1 truncate text-xl font-bold ${t.judgment === 'na' ? 'text-slate-500' : 'text-slate-900'}`}>{t.value}</p>
      {t.sub && <p className="mt-0.5 truncate text-[11px] text-slate-500">{t.sub}</p>}
      <p
        className={`mt-1.5 truncate text-[11px] ${
          t.judgment === 'danger' ? 'text-red-700' : t.judgment === 'warn' ? 'text-amber-800' : 'text-slate-500'
        }`}
      >
        {t.reason}
      </p>
    </>
  );
  const cls = 'block min-w-0 rounded-xl bg-white p-3 shadow-sm';
  return t.href ? (
    <Link href={t.href} className={`${cls} transition-colors hover:bg-slate-50`} title={`${t.label}: ${t.reason}`}>
      {body}
    </Link>
  ) : (
    <section className={cls} title={`${t.label}: ${t.reason}`}>
      {body}
    </section>
  );
}

function DecisionRow({ d }: { d: Decision }) {
  return (
    <li>
      <Link href={d.href} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
        <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${d.level === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-800">{d.title}</span>
          {d.detail && <span className="block truncate text-[11px] text-slate-500">{d.detail}</span>}
        </span>
      </Link>
    </li>
  );
}

function TeamRow({ t }: { t: TeamCard }) {
  const judged: Judgment = t.overdue == null ? 'na' : t.overdue > 0 ? 'danger' : t.waiting && t.waiting > 0 ? 'warn' : 'ok';
  return (
    <Link href={t.href} className="flex min-w-0 items-center gap-3 rounded-xl bg-white p-3 shadow-sm transition-colors hover:bg-slate-50">
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[judged]}`} aria-label={JUDGE_JA[judged]} role="img" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800">{t.name}</span>
        <span className="block truncate text-[11px] text-slate-500">責任者 {t.leader ?? '未設定'}</span>
      </span>
      <span className="tabular shrink-0 text-right text-[11px] text-slate-600">
        {t.open == null ? (
          <span className="text-slate-400">Kintone未対応</span>
        ) : (
          <>
            <span className="block">未完了 {t.open}</span>
            <span className={`block ${t.overdue ? 'font-semibold text-red-700' : ''}`}>期限超過 {t.overdue}</span>
          </>
        )}
      </span>
      <ArrowRight size={14} className="shrink-0 text-slate-400" aria-hidden />
    </Link>
  );
}

export default async function ProHomePage() {
  const actor = await requireActor();
  if (!canSeeCompanyWide(actor.level)) redirect('/pro/today');
  const d = await getCompanyOverview(actor);

  const kpiConnected = d.kpi.status === 'ok';
  const monthLabel = `${Number(d.month.slice(0, 4))}年${Number(d.month.slice(5, 7))}月`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">経営ダッシュボード</h1>
          <p className="text-xs text-slate-500">
            {monthLabel} / 今日 {d.today}
            {d.monthly?.latestDate ? ` / KPI最新日 ${d.monthly.latestDate}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${kpiConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
            <Database size={11} aria-hidden />
            KPI報告({d.kpi.appId}) {kpiConnected ? '接続中' : '未接続'}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${d.tasks.source === 'kintone' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
            <Database size={11} aria-hidden />
            タスク {d.tasks.source === 'kintone' ? 'Kintone(38)' : 'ローカルDB'}
          </span>
        </div>
      </div>

      {!kpiConnected && (
        <Notice tone="warn">
          売上・広告費は Kintone 毎朝KPI報告(30) 未接続のため「未接続」表示です（{d.kpi.status === 'unavailable' ? d.kpi.reason : ''}）。
          接続設定は <Link href="/integrations" className="underline">データ連携設定</Link> から。
        </Notice>
      )}
      {d.tasks.notice && <Notice tone="info">{d.tasks.notice}</Notice>}

      <section aria-label="KPI" className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 xl:grid-cols-4">
        {d.tiles.map((t) => (
          <Tile key={t.key} t={t} />
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
              <AlertTriangle size={14} className="text-red-600" aria-hidden />
              今日の判断事項
            </h2>
            <Link href="/pro/alerts" className="inline-flex items-center gap-1 text-[11px] text-blue-900 hover:underline">
              <Bell size={11} aria-hidden />
              アラート {d.alerts.red + d.alerts.yellow}件
            </Link>
          </div>
          {d.decisions.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">
              🔴の項目はありません{!kpiConnected ? '（売上・広告費はKPI未接続のため未判定）' : ''}
            </p>
          ) : (
            <ul className="-mx-2 divide-y divide-slate-100">
              {d.decisions.map((x, i) => (
                <DecisionRow key={`${x.kind}-${i}`} d={x} />
              ))}
            </ul>
          )}
        </section>

        <section className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
              <Building2 size={14} aria-hidden />
              部署
            </h2>
            <Link href="/pro/teams" className="text-[11px] text-blue-900 hover:underline">
              一覧へ
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {d.teams.map((t) => (
              <TeamRow key={t.code} t={t} />
            ))}
          </div>
        </section>
      </div>

      <p className="text-[11px] text-slate-500">
        判定基準: 目標ペース ≥100%🟢 / ≥90%🟡 / 未満🔴、広告費率 ≤15%🟢 / ≤20%🟡 / 超過🔴、期限超過 0🟢 / 1〜2🟡 / 3件以上🔴（docs/business.md §6）。
        粗利は原価データ未連携のため未取得、在庫金額は在庫報告(35)未連携のため未取得です。
      </p>
    </div>
  );
}
