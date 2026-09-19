// レポート（STANDARD）: ①PRO 報告（日報／週報／中間報告）の一覧 ②定時レポート（GitHub Actions → Chatwork/Kintone）の一覧 ③日別売上CSVのダウンロード。
// 数字は出さず、器と導線だけ。CSV は /api/reports/daily-sales.csv（ログイン必須・KpiDaily から）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor, canSeeCompanyWide } from '@/lib/rbac';
import { listReports, REPORT_STATUS_JA, REPORT_TYPE_JA } from '@/lib/pro/reports';
import { getKpiDailyMonths, getKpiDailyRows } from '@/lib/ad-data';
import { SCHEDULED_REPORTS } from '@/lib/reports-schedule';
import { csvFileName } from '@/lib/metrics/daily-sales-csv';
import { jstDateKey } from '@/lib/metrics/format';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const sp = await searchParams;
  const thisMonth = jstDateKey(new Date()).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : thisMonth;
  const companyWide = canSeeCompanyWide(actor.level);

  const [reports, months, rows] = await Promise.all([
    listReports({ visibleAuthorId: companyWide ? undefined : actor.id, visibleTeamCode: companyWide ? undefined : actor.teamCode }),
    getKpiDailyMonths(thisMonth),
    getKpiDailyRows(month),
  ]);
  const recent = reports.slice(0, 20);
  const byType = { daily: 0, weekly: 0, interim: 0 };
  for (const r of reports) byType[r.type]++;
  const csvHref = `/api/reports/daily-sales.csv?month=${month}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800">レポート</h1>
        <p className="text-xs text-slate-500">
          社内の報告（日報／週報／中間報告）、自動配信の定時レポート、CSVダウンロードをまとめた入口。集計値は各画面（売上・広告分析・合算CPA）で確認してください。
        </p>
      </div>

      {/* ③ CSV */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">日別売上CSV（媒体別売上・日別目標・媒体別広告費・広告費率）</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              出典: KpiDaily（Kintone 毎朝KPI報告(30) の日次取込）。UTF-8 BOM 付きで Excel でそのまま開けます。数字は取込値のみ（目標未入力は空欄・売上0の日の広告費率は空欄）。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {months.map((m) => (
              <Link
                key={m}
                href={`/reports?month=${m}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${m === month ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100'}`}
              >
                {m}
              </Link>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {rows.length > 0 ? (
            <a href={csvHref} download={csvFileName(month)} className="inline-flex items-center rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
              {month} の日別売上CSVをダウンロード（{rows.length}日分）
            </a>
          ) : (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-500">{month} は取込済みの日がありません（CSVは空になります）</span>
          )}
          <span className="text-[11px] text-slate-500">
            対象 {rows.length > 0 ? `${rows[0].date} 〜 ${rows[rows.length - 1].date}` : '—'} ／ ファイル名 {csvFileName(month)}
          </span>
        </div>
      </div>

      {/* ① PRO 報告 */}
      <div className="rounded-xl bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">社内の報告（日報／週報／中間報告）</h2>
            <p className="text-[11px] text-slate-500">
              日報 {byType.daily}件 ／ 週報 {byType.weekly}件 ／ 中間報告 {byType.interim}件（{companyWide ? '全社' : '自分と自チーム'}・最新20件を表示）
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <Link href="/pro/reports" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
              PRO 報告を開く
            </Link>
            <Link href="/pro/reports?new=1" className="rounded-md bg-blue-900 px-3 py-1.5 font-medium text-white hover:bg-blue-800">
              報告を書く
            </Link>
          </div>
        </div>
        {recent.length === 0 ? (
          <div className="border-t border-slate-100 px-4 py-6">
            <p className="text-sm font-medium text-slate-700">報告はまだありません。</p>
            <p className="mt-1 text-xs text-slate-500">朝礼の「数字→学び→今日」の順で書けます。中間報告はリーダー向けにタスク状況から下書きを自動生成できます（PRO 報告）。</p>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">期間</th>
                  <th className="px-2 py-2 text-left">種類</th>
                  <th className="px-2 py-2 text-left">部署</th>
                  <th className="px-2 py-2 text-left">タイトル</th>
                  <th className="px-2 py-2 text-left">作成者</th>
                  <th className="px-2 py-2 text-left">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 tabular-nums text-slate-700">
                      {r.periodFrom.slice(5).replace('-', '/')}
                      {r.periodTo !== r.periodFrom ? `〜${r.periodTo.slice(5).replace('-', '/')}` : ''}
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">{REPORT_TYPE_JA[r.type]}</td>
                    <td className="px-2 py-1.5 text-slate-700">{r.teamName}</td>
                    <td className="px-2 py-1.5">
                      <Link href={`/pro/reports?id=${r.id}`} className="font-medium text-slate-800 hover:underline">
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">{r.authorName}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">{REPORT_STATUS_JA[r.status] ?? r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ② 定時レポート */}
      <div className="rounded-xl bg-white shadow-sm">
        <div className="px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">定時レポート（自動配信・JST）</h2>
          <p className="text-[11px] text-slate-500">
            出典: docs/business.md §5.2「1日の流れ」。配信は GitHub Actions（daily-report-system）。本文は Chatwork の各ルーム／Kintone で見る（ダッシュボードからのリンクは未接続・URL未提供）。
          </p>
        </div>
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">時刻</th>
                <th className="px-2 py-2 text-left">レポート</th>
                <th className="px-2 py-2 text-left">内容</th>
                <th className="px-2 py-2 text-left">出力先</th>
                <th className="px-2 py-2 text-left">ダッシュボードの対応画面</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {SCHEDULED_REPORTS.map((r) => (
                <tr key={`${r.time}-${r.name}`} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-700">{r.time}</td>
                  <td className="px-2 py-1.5 font-medium text-slate-800">{r.name}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-600">{r.detail}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-600">
                    {r.destination}
                    {r.destination.startsWith('Chatwork') && <span className="ml-1 text-slate-400">（Chatworkで見る）</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {r.href ? (
                      <Link href={r.href} className="text-blue-900 hover:underline">
                        {r.href}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
