// AI改善提案（STANDARD）: Proposal テーブルの一覧（デモ除外・状態切替は editor 以上のサーバーアクション）＋ ?tab=alerts で未解決アラート。
// LLM 提案の生成器は未接続（成功と偽らない）。ルール提案はアラートセンター（/pro/alerts）と統合中。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canWrite } from '@/lib/auth';
import { currentActor } from '@/lib/rbac';
import { listOpenAlerts, type AlertItem } from '@/lib/pro/alerts';
import { listProposals } from '@/lib/proposals-data';
import { PROPOSAL_SOURCE_JA, PROPOSAL_STATUS_JA } from '@/lib/metrics/proposals';
import ProposalStatus, { StatusBadge } from './ProposalStatus';

export const dynamic = 'force-dynamic';

type Tab = 'proposals' | 'alerts';

const fmtDate = (iso: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(new Date(iso));
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function AlertRow({ a }: { a: AlertItem }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <span className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${a.level === 'red' ? 'bg-red-500' : 'bg-amber-400'}`} aria-label={a.level === 'red' ? '重要' : '注意'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{a.code}</span>
          {a.teamName && <span>{a.teamName}</span>}
          <span className="text-slate-400">初回 {fmtDate(a.firstSeenAt)} ／ 最終確認 {fmtDateTime(a.lastSeenAt)}</span>
        </div>
        <Link href={a.href} className="text-sm font-medium text-slate-800 hover:text-blue-900 hover:underline">
          {a.title}
        </Link>
        {a.detail && <p className="text-[11px] leading-snug text-slate-500">{a.detail}</p>}
      </div>
    </li>
  );
}

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'alerts' ? 'alerts' : 'proposals';
  const writer = canWrite(actor.role);

  const [{ items, summary, demoCount, llmCount }, alerts] = await Promise.all([listProposals(), tab === 'alerts' ? listOpenAlerts(actor) : Promise.resolve<AlertItem[]>([])]);
  const red = alerts.filter((a) => a.level === 'red');
  const yellow = alerts.filter((a) => a.level === 'yellow');

  const tabCls = (t: Tab) => `rounded-full px-3 py-1 text-xs font-medium ${t === tab ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">AI改善提案</h1>
          <p className="text-xs text-slate-500">
            ルールで検知した異常と、その判断（採用／保留／却下）を残す場所。数字の根拠は各提案に明記。LLM による提案生成は<span className="font-medium text-slate-700">未接続</span>
            （ルール提案のみ）。
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/proposals" className={tabCls('proposals')}>
            提案 {summary.total}件
          </Link>
          <Link href="/proposals?tab=alerts" className={tabCls('alerts')}>
            アラート{tab === 'alerts' ? ` ${alerts.length}件` : ''}
          </Link>
        </div>
      </div>

      {tab === 'proposals' ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(['open', 'held', 'adopted', 'rejected'] as const).map((s) => (
              <div key={s} className="rounded-xl bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">{PROPOSAL_STATUS_JA[s]}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{summary[s]}件</p>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-900">
            LLM提案: <span className="font-medium">未接続</span>（生成器・APIキーの接続待ち。
            <Link href="/integrations#llm" className="underline">
              データ連携設定
            </Link>
            ）。LLM由来の提案 {llmCount}件。
            {demoCount > 0 && <span className="ml-1 text-blue-800/80">デモ提案 {demoCount}件は集計・一覧から除外しています。</span>}
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-700">実データの提案はまだありません。</p>
              <p className="mt-1 text-xs text-slate-500">
                ルール提案はアラートセンターと統合中です。現在の異常（目標未達ペース・広告費率・期限超過など）は
                <Link href="/proposals?tab=alerts" className="mx-1 text-blue-900 underline">
                  アラートタブ
                </Link>
                で確認してください。
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((p) => (
                <li key={p.id} className="rounded-xl bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">P{p.priority}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{PROPOSAL_SOURCE_JA[p.source] ?? p.source}</span>
                        {p.ruleCode && <span>{p.ruleCode}</span>}
                        {p.targetLabel && <span>対象: {p.targetLabel}</span>}
                        {p.period && <span>期間: {p.period}</span>}
                        <span className="text-slate-400">作成 {fmtDate(p.createdAt)}</span>
                        {p.dataAsOf && <span className="text-slate-400">データ時点 {fmtDateTime(p.dataAsOf)}</span>}
                        <StatusBadge status={p.status} />
                      </div>
                      <h2 className="mt-1 text-sm font-bold text-slate-800">{p.title}</h2>
                      {Object.keys(p.facts).length > 0 && (
                        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                          {Object.entries(p.facts).map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                              <dt className="shrink-0 text-slate-500">{k}</dt>
                              <dd className="font-medium tabular-nums text-slate-800">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {p.hypothesis && (
                        <p className="mt-2 text-xs text-slate-700">
                          <span className="text-slate-500">仮説: </span>
                          {p.hypothesis}
                        </p>
                      )}
                      {p.action && (
                        <p className="mt-1 text-xs text-slate-700">
                          <span className="text-slate-500">打ち手: </span>
                          {p.action}
                        </p>
                      )}
                      {p.effectNote && (
                        <p className="mt-1 text-xs text-slate-600">
                          <span className="text-slate-500">効果試算: </span>
                          {p.effectNote}
                        </p>
                      )}
                    </div>
                    <div className="w-full shrink-0 md:w-72">
                      <ProposalStatus id={p.id} status={p.status} statusNote={p.statusNote} canWrite={writer} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">重要（🔴）</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-red-700">{red.length}件</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">注意（🟡）</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-amber-700">{yellow.length}件</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">解決・ミュート・再評価</p>
              <Link href="/pro/alerts" className="mt-1 inline-block text-sm font-bold text-blue-900 hover:underline">
                PRO アラートセンターを開く →
              </Link>
              <p className="text-[11px] text-slate-500">ここは閲覧のみ。ルールの再評価と操作はアラートセンターで行います</p>
            </div>
          </div>
          {alerts.length === 0 ? (
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-700">未解決のアラートはありません。</p>
              <p className="mt-1 text-xs text-slate-500">
                アラートはアラートセンター（/pro/alerts）または経営ダッシュボード（/pro）を開いたときにルール評価され、ここに反映されます。一般社員は自チーム分のみ表示します。
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-white shadow-sm">
              {red.length > 0 && (
                <>
                  <p className="border-b border-slate-100 px-3 py-2 text-xs font-bold text-red-700">重要 {red.length}件</p>
                  <ul className="divide-y divide-slate-100">{red.map((a) => <AlertRow key={a.id} a={a} />)}</ul>
                </>
              )}
              {yellow.length > 0 && (
                <>
                  <p className="border-b border-t border-slate-100 px-3 py-2 text-xs font-bold text-amber-700">注意 {yellow.length}件</p>
                  <ul className="divide-y divide-slate-100">{yellow.map((a) => <AlertRow key={a.id} a={a} />)}</ul>
                </>
              )}
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            ルールの出典: docs/business.md §6（広告費率 目標15%／許容20%、目標未達ペース）、docs/pro-plan.md §5⑧（期限超過・確認待ち滞留・担当者未設定・長期未更新・タスク集中）。
          </p>
        </>
      )}
    </div>
  );
}
