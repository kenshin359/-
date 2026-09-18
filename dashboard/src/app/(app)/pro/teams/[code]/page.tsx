// PRO ② 部署ダッシュボード（部署 → 担当者）。目標・KPI・問題・担当者別の負荷・最新報告・メモ。
// 一般社員は自部署のみ（他部署は notFound）。数字は listTasks（Kintone/ローカル）と Prisma（Kpi/Report/Note）から。
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Activity, AlertTriangle, ArrowLeft, CalendarClock, Hourglass, NotebookPen, StickyNote, UserX, Users } from 'lucide-react';
import { Notice } from '@/components/ui';
import { canSeeCompanyWide, requireActor } from '@/lib/rbac';
import { canWrite } from '@/lib/auth';
import { getTeamDashboard, ownTeamCodeFor, WAITING_STALE_DAYS, WEEK_AHEAD_DAYS, type Judgment, type MemberLoad, type Problem } from '@/lib/pro/team-dashboard';
import { fmtDateShortJa, fmtDateTimeJa, fmtDue } from '@/lib/pro/format';
import TeamNewTask from './TeamNewTask';

export const dynamic = 'force-dynamic';

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  return { title: `部署: ${code}` };
}

const REPORT_TYPE_JA: Record<string, string> = { daily: '日報', weekly: '週報', interim: '中間報告' };
const REPORT_STATUS_JA: Record<string, string> = { draft: '下書き', submitted: '提出済み', reviewed: '確認済み' };

const JUDGMENT_CLS: Record<Judgment, string> = {
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  none: 'bg-slate-100 text-slate-600 ring-slate-200',
};
const JUDGMENT_MARK: Record<Judgment, string> = { ok: '🟢', warn: '🟡', danger: '🔴', none: '—' };

const PROBLEM_ICON: Record<Problem['kind'], typeof AlertTriangle> = { overdue: AlertTriangle, waitingStale: Hourglass, noAssignee: UserX };
const PROBLEM_CLS: Record<Problem['kind'], string> = {
  overdue: 'border-red-200 text-red-700',
  waitingStale: 'border-amber-200 text-amber-800',
  noAssignee: 'border-slate-300 text-slate-700',
};

function fmtValue(v: number, unit: string): string {
  if (unit === '円') return `¥${Math.round(v).toLocaleString('ja-JP')}`;
  if (unit === '%') return `${v.toFixed(1)}%`;
  if (unit === '倍') return `${v.toFixed(2)}倍`;
  return `${v.toLocaleString('ja-JP')}${unit}`;
}

export default async function TeamPage({ params }: { params: Params }) {
  const [{ code }, actor] = await Promise.all([params, requireActor()]);
  // 一般社員は自部署以外を見られない（存在も明かさない）
  if (!canSeeCompanyWide(actor.level) && ownTeamCodeFor(actor) !== code) notFound();
  const d = await getTeamDashboard(code);
  if (!d) notFound();
  const editable = canWrite(actor.role);
  const s = d.summary;

  return (
    <div className="space-y-4">
      <nav aria-label="パンくず" className="text-xs text-slate-500">
        <Link href="/pro/teams" className="inline-flex items-center gap-1 hover:text-slate-900">
          <ArrowLeft size={12} aria-hidden />
          部署一覧
        </Link>
        {d.parentName && <span> / {d.parentName}</span>}
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900">{d.name}</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            責任者 <span className="font-medium text-slate-800">{d.leader ?? '未設定'}</span>
            {d.kintoneLabels.length > 0 && <span>・Kintoneチーム: {d.kintoneLabels.join('・')}</span>}
          </p>
          {d.members.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="メンバー">
              {d.members.map((m) => (
                <li key={m} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
        {editable && <TeamNewTask options={d.options} defaultTeam={d.kintoneLabels[0]} defaultAssignee={d.leader && d.options.members.includes(d.leader) ? d.leader : undefined} />}
      </header>

      {d.notice && <Notice tone={d.source === 'local' ? 'warn' : 'info'}>{d.notice}</Notice>}
      {d.kintoneLabels.length === 0 && (
        <Notice tone="info">この部署は Kintone タスク管理の「チーム」選択肢に対応が無いため、タスク集計は未対応です（KPI・報告・メモは使えます）。</Notice>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="部署の状況">
        <Stat label="未完了" n={s.open} tone="text-slate-900" />
        <Stat label="期限超過" n={s.overdue} tone={s.overdue ? 'text-red-700' : 'text-slate-900'} />
        <Stat label={`確認待ち滞留（${WAITING_STALE_DAYS}日超）`} n={s.waitingStale} tone={s.waitingStale ? 'text-amber-800' : 'text-slate-900'} sub={`確認待ち ${s.waiting}`} />
        <Stat label={`${WEEK_AHEAD_DAYS}日以内の期限`} n={s.dueThisWeek} tone="text-slate-900" />
        <Stat label="担当者未設定" n={s.noAssignee} tone={s.noAssignee ? 'text-amber-800' : 'text-slate-900'} />
      </dl>

      {/* KPI */}
      <section aria-labelledby="kpi-h" className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 id="kpi-h" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Activity size={14} aria-hidden />
            目標・KPI
          </h2>
          <Link href="/pro/kpi" className="text-xs font-medium text-blue-900 underline-offset-2 hover:underline">
            KPI一覧
          </Link>
        </div>
        {d.kpis.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-slate-300 px-3 py-3 text-xs leading-relaxed text-slate-500">
            KPI未設定。この部署の目標・KPI は{' '}
            <Link href="/pro/kpi" className="font-medium text-blue-900 underline underline-offset-2">
              KPI一覧
            </Link>{' '}
            で登録すると、判定つきでここに出ます（数値は推測で埋めません）。
          </p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d.kpis.map((k) => (
              <li key={k.code} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/pro/kpi/${k.code}`} className="truncate text-xs font-medium text-slate-700 hover:text-slate-900">
                    {k.name}
                  </Link>
                  <span title={k.judgmentReason} className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${JUDGMENT_CLS[k.judgment]}`}>
                    {JUDGMENT_MARK[k.judgment]} {k.judgmentReason}
                  </span>
                </div>
                <p className="tabular mt-1 text-lg font-bold leading-tight text-slate-900">{k.latest ? fmtValue(k.latest.value, k.unit) : '実績なし'}</p>
                <p className="tabular text-[11px] text-slate-500">
                  目標 {k.targetValue != null ? fmtValue(k.targetValue, k.unit) : '未設定'}
                  {k.latest && `・${k.latest.date} 時点`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 問題 */}
      <section aria-labelledby="prob-h" className="rounded-xl bg-white p-4 shadow-sm">
        <h2 id="prob-h" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <AlertTriangle size={14} aria-hidden />
          問題
          <span className="tabular rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{d.problems.length}</span>
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">期限超過 → 確認待ち滞留 → 担当者未設定 の順</p>
        {d.problems.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">いま止まっている仕事はありません。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {d.problems.map((p) => {
              const Icon = PROBLEM_ICON[p.kind];
              return (
                <li key={`${p.kind}:${p.task.id}`} className={`flex items-start gap-2 rounded-md border bg-white px-2.5 py-2 ${PROBLEM_CLS[p.kind]}`}>
                  <Icon size={14} aria-hidden className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug text-slate-900">{p.task.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      <span className="font-medium">{p.label}</span>・{p.detail}・{p.task.assignee || '未割当'}・{p.task.priority}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 担当者別 */}
      <section aria-labelledby="mem-h">
        <h2 id="mem-h" className="mb-1.5 inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Users size={14} aria-hidden />
          担当者別
        </h2>
        {d.memberLoads.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-xs text-slate-500 shadow-sm">担当者が登録されていません。</p>
        ) : (
          <div className="scroll-x -mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
            <ul className="flex snap-x gap-3 lg:grid lg:grid-cols-3 xl:grid-cols-4">
              {d.memberLoads.map((m) => (
                <li key={m.name} className="w-[240px] shrink-0 snap-start lg:w-auto">
                  <MemberColumn m={m} today={d.today} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 最新報告 */}
        <section aria-labelledby="rep-h" className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 id="rep-h" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <NotebookPen size={14} aria-hidden />
              最新の報告
            </h2>
            <Link href="/pro/reports" className="text-xs font-medium text-blue-900 underline-offset-2 hover:underline">
              報告一覧
            </Link>
          </div>
          {d.reports.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">この部署の報告はまだありません。右上の「追加」→「報告」から。</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {d.reports.map((r) => (
                <li key={r.id} className="py-2">
                  <Link href="/pro/reports" className="block hover:text-slate-900">
                    <p className="text-[13px] font-medium leading-snug text-slate-900">{r.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {REPORT_TYPE_JA[r.type] ?? r.type}・{fmtDateShortJa(r.periodFrom)}〜{fmtDateShortJa(r.periodTo)}・{r.authorName ?? '作成者不明'}・
                      {REPORT_STATUS_JA[r.status] ?? r.status}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* メモ */}
        <section aria-labelledby="note-h" className="rounded-xl bg-white p-4 shadow-sm">
          <h2 id="note-h" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <StickyNote size={14} aria-hidden />
            部署メモ
          </h2>
          {d.notes.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">この部署に紐づくメモはまだありません。</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {d.notes.map((n) => (
                <li key={n.id} className="py-2">
                  <p className="whitespace-pre-wrap text-[13px] leading-snug text-slate-800">{n.body}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {n.authorName ?? '—'}・{fmtDateTimeJa(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, n, tone, sub }: { label: string; n: number; tone: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className={`tabular text-xl font-bold leading-tight ${tone}`}>{n}</dd>
      {sub && <dd className="text-[10px] text-slate-400">{sub}</dd>}
    </div>
  );
}

function MemberColumn({ m, today }: { m: MemberLoad; today: string }) {
  const name = m.userId ? (
    <Link href={`/pro/people/${m.userId}`} className="truncate text-sm font-bold text-blue-900 underline-offset-2 hover:underline">
      {m.name}
    </Link>
  ) : (
    <span className="truncate text-sm font-bold text-slate-900">{m.name}</span>
  );
  const top = m.tasks.slice(0, 3);
  return (
    <article className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2">
        <div className="min-w-0">
          {name}
          <p className="text-[11px] text-slate-500">
            {m.nextDue ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={11} aria-hidden />
                次の期限 {fmtDue(m.nextDue)}
              </span>
            ) : (
              '今後の期限なし'
            )}
          </p>
        </div>
        <span title={m.load.reason} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${JUDGMENT_CLS[m.load.tone]}`}>
          {m.load.label}
        </span>
      </header>
      <dl className="grid grid-cols-3 gap-1 px-3 py-2 text-center">
        <div>
          <dt className="text-[10px] text-slate-500">未完了</dt>
          <dd className="tabular text-base font-bold text-slate-900">{m.open}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-slate-500">期限超過</dt>
          <dd className={`tabular text-base font-bold ${m.overdue ? 'text-red-700' : 'text-slate-900'}`}>{m.overdue}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-slate-500">確認待ち</dt>
          <dd className={`tabular text-base font-bold ${m.waiting ? 'text-amber-800' : 'text-slate-900'}`}>{m.waiting}</dd>
        </div>
      </dl>
      {top.length > 0 && (
        <ul className="space-y-1 border-t border-slate-200/70 px-3 py-2">
          {top.map((t) => {
            const overdue = !!t.due && t.due < today;
            return (
              <li key={t.id} className="flex items-baseline gap-1.5 text-[11px] leading-snug">
                <span className={`shrink-0 font-bold ${t.priority === 'P1' ? 'text-red-700' : 'text-slate-500'}`}>{t.priority}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800">{t.title}</span>
                {t.due && <span className={`tabular shrink-0 ${overdue ? 'text-red-700' : 'text-slate-500'}`}>{fmtDue(t.due)}</span>}
              </li>
            );
          })}
          {m.tasks.length > top.length && <li className="text-[11px] text-slate-400">ほか {m.tasks.length - top.length} 件</li>}
        </ul>
      )}
    </article>
  );
}
