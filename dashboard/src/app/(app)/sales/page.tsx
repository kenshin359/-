// 売上・利益（STANDARD）: 月サマリー（累計・チャネル別・前月同期間比・客単価）と日別表（前日比・日別目標・達成率）。
// 集計は src/lib/metrics/sales-daily.ts・daily-targets.ts・kpi-kintone.computeMonthlyOverview のみ（画面で独自計算しない）。
// 出典: Kintone 毎朝KPI報告(30)（売上）／売上明細(29)（客単価の個数）。粗利は原価率未入力のため「未取得」。
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import DailyJudgeBadge from '@/components/DailyJudgeBadge';
import { authOptions } from '@/lib/auth';
import { formatMetric, formatYen, jstDateKey } from '@/lib/metrics/format';
import type { MetricValue } from '@/lib/metrics/types';
import { getSalesMonth } from '@/lib/sales-data';
import { getKpiMonths } from '@/lib/targets-data';

export const dynamic = 'force-dynamic';

function changeText(m: MetricValue, digits = 1): string {
  if (m.kind === 'na') return m.reason;
  return `${m.value >= 0 ? '+' : ''}${m.value.toFixed(digits)}%`;
}

function changeClass(m: MetricValue): string {
  if (m.kind === 'na') return 'text-slate-400';
  return m.value >= 0 ? 'text-emerald-700' : 'text-red-600';
}

function Card({ label, value, sub, tone = 'default', href }: { label: string; value: string; sub?: string; tone?: 'default' | 'dark' | 'muted'; href?: string }) {
  const box = tone === 'dark' ? 'bg-slate-900 text-white' : 'bg-white';
  const val = tone === 'dark' ? 'text-white' : tone === 'muted' ? 'text-slate-500' : 'text-slate-900';
  const sm = tone === 'dark' ? 'text-slate-300' : 'text-slate-500';
  const body = (
    <>
      <p className={`text-xs ${sm}`}>{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${val}`}>{value}</p>
      {sub && <p className={`text-[11px] ${sm}`}>{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className={`block rounded-xl p-4 shadow-sm hover:bg-slate-50 ${box}`}>
      {body}
    </Link>
  ) : (
    <div className={`rounded-xl p-4 shadow-sm ${box}`}>{body}</div>
  );
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const thisMonth = jstDateKey(new Date()).slice(0, 7);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : thisMonth;
  const [data, months] = await Promise.all([getSalesMonth(month), getKpiMonths(thisMonth)]);
  const { overview: ov, kpi, targets } = data;
  const fmtDate = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  const m = Number(month.slice(5));

  const sourceNote =
    kpi.status === 'ok'
      ? kpi.source === 'cache'
        ? `Kintone 毎朝KPI報告(${kpi.appId}) の日次キャッシュ${kpi.cachedAt ? `（最終取込 ${fmtDate(new Date(kpi.cachedAt))}）` : ''}`
        : `Kintone 毎朝KPI報告(${kpi.appId}) 直接読み取り`
      : `未接続: ${kpi.reason}`;

  const totals = data.daily.reduce(
    (a, r) => ({ rakuten: a.rakuten + r.rakuten, amazon: a.amazon + r.amazon, own: a.own + r.own, total: a.total + r.total, target: a.target + r.target }),
    { rakuten: 0, amazon: 0, own: 0, total: 0, target: 0 },
  );
  const totalAchievement: MetricValue = totals.target > 0 ? { kind: 'value', value: (totals.total / totals.target) * 100 } : { kind: 'na', reason: '目標未設定' };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">売上・利益 — 月次サマリーと日別売上</h1>
          <p className="text-xs text-slate-500">
            出典: {sourceNote}
            {ov?.latestDate ? ` ／ 対象 ${month}-01 〜 ${ov.latestDate}（${ov.dataDays}日分）` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {months.map((mm) => (
            <Link
              key={mm}
              href={`/sales?month=${mm}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${mm === month ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'}`}
            >
              {mm}
            </Link>
          ))}
        </div>
      </div>

      {kpi.status !== 'ok' ? (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-700">{month} の売上データがありません（未接続または未取込）。</p>
          <p className="mt-1 text-xs text-slate-500">{kpi.reason}。接続状況は <Link href="/integrations" className="underline">連携設定</Link> を確認してください。推測値は表示しません。</p>
        </div>
      ) : !ov || ov.dataDays === 0 ? (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-700">{month} の売上はまだ取り込まれていません。</p>
          <p className="mt-1 text-xs text-slate-500">毎朝11:20の「ダッシュボード取込」で入ります。推測値は表示しません。</p>
        </div>
      ) : (
        <>
          {/* ① 月サマリー */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label={`累計売上（${ov.dataDays}日分・最新 ${m}/${Number(ov.latestDate?.slice(8, 10))}）`} value={formatYen(ov.monthToDate)} sub={`直近${ov.avg7Days}日平均 ${formatMetric(ov.avg7, '円')}／日`} tone="dark" />
            {data.channels.map((c) => (
              <div key={c.key} className="rounded-xl bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">{c.label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{formatYen(c.amount)}</p>
                <p className="text-[11px] text-slate-500">構成比 {formatMetric(c.share, '%', 1)}</p>
                <div className="mt-2 h-1.5 w-full rounded bg-slate-100">
                  <div className="h-1.5 rounded bg-slate-800" style={{ width: `${c.share.kind === 'value' ? Math.min(100, c.share.value) : 0}%` }} />
                </div>
              </div>
            ))}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">前月同期間比（前月1〜{ov.elapsedDays}日と比較）</p>
              <p className={`mt-1 text-lg font-bold tabular-nums ${changeClass(ov.prevSamePeriodChange)}`}>{changeText(ov.prevSamePeriodChange)}</p>
              <p className="text-[11px] text-slate-500">
                {ov.prevSamePeriod == null ? `前月（${ov.prevSamePeriodDays}日分）のKPI報告がありません` : `前月同期間 ${formatYen(ov.prevSamePeriod)}（${ov.prevSamePeriodDays}日分）`}
              </p>
            </div>
            <Card
              label="客単価（売上明細ベース: 税込売上 ÷ 販売個数）"
              value={formatMetric(data.unitPrice, '円')}
              sub={data.productDays > 0 ? `${data.productUnits.toLocaleString('ja-JP')}個／${formatYen(data.productAmount)}（${data.productDays}日分・全商品）` : '売上明細(29) の取込後に表示'}
            />
            <Card
              label={`月間目標 / 達成率（${targets.isDefault ? '仮置き' : '登録値'}）`}
              value={formatMetric(ov.achievementRate, '%', 1)}
              sub={`目標 ${formatYen(targets.main)}（ストレッチ ${formatYen(targets.stretch)}）／必要日販 ${formatMetric(ov.requiredDailyMain, '円')}`}
              href="/targets"
            />
            <Card label="粗利" value={formatMetric(data.grossProfit, '円')} sub="原価率（仕入原価）が入力されるまで算出しません（推測値は出しません）" tone="muted" />
          </div>

          {/* ② 日別表 */}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">日付</th>
                  <th className="px-2 py-2 text-right">楽天</th>
                  <th className="px-2 py-2 text-right">Amazon</th>
                  <th className="px-2 py-2 text-right">自社サイト</th>
                  <th className="px-2 py-2 text-right">合計</th>
                  <th className="px-2 py-2 text-right">前日比</th>
                  <th className="px-2 py-2 text-right">日別目標</th>
                  <th className="px-2 py-2 text-right">達成率</th>
                  <th className="px-2 py-2 text-left">判定</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.daily.map((r) => (
                  <tr key={r.date} className={`hover:bg-slate-50 ${r.weight !== 1 ? 'bg-amber-50/60' : ''}`}>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-700">
                      {m}/{r.day}
                      {r.label && <span className="ml-2 text-[11px] text-amber-700">{r.label}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{formatYen(r.rakuten)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{formatYen(r.amazon)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{formatYen(r.own)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">{formatYen(r.total)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums text-xs ${changeClass(r.dayOverDay)}`}>{changeText(r.dayOverDay)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{r.target > 0 ? formatYen(r.target) : <span className="text-slate-300">−</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{formatMetric(r.achievement, '%', 0)}</td>
                    <td className="px-2 py-1.5">
                      <DailyJudgeBadge j={r.judgement} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
                <tr>
                  <td className="px-3 py-2">合計（{data.daily.length}日分）</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(totals.rakuten)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(totals.amazon)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(totals.own)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(totals.total)}</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right tabular-nums">{totals.target > 0 ? formatYen(totals.target) : '−'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMetric(totalAchievement, '%', 0)}</td>
                  <td className="px-2 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            日別目標 = 月間目標 × その日の重み ÷ 月内の重み合計（
            {data.weightsSaved ? '重みは目標・予実管理の登録値' : '重みが未登録のため全日 1.0 で等分'}
            、docs/business.md §6）。判定: 売上÷日別目標 ≥100% 好調／≥70% まずまず／未満 要改善。前日比は暦日の前日にデータがある日のみ。
            未取込の日は 0 にせず表に載せません。<Link href="/targets" className="underline">目標・予実管理</Link> で目標と重みを変更できます。
          </p>
        </>
      )}
    </div>
  );
}
