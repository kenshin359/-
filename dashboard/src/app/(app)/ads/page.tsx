// 広告分析（STANDARD）: 媒体別（Google／楽天RPP／Amazon広告／Meta）の月合計・構成比・日別、広告費率と現場基準（15%/20%）の判定、7日移動広告費。
// 集計は src/lib/metrics/ad-daily.ts のみ（画面で独自計算しない）。元データは KpiDaily（Kintone 毎朝KPI報告(30) の取込）。
// ROAS・CPC等は帰属売上・クリックの取込が無いため「未取得」と明記する（総売上÷広告費で代用しない）。
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getAdMonth, getKpiDailyMonths } from '@/lib/ad-data';
import { AD_MEDIA, AD_UNAVAILABLE_METRICS } from '@/lib/metrics/ad-daily';
import { JUDGEMENT_JA, type CpaJudgement } from '@/lib/metrics/cpa';
import { formatMetric, formatYen, jstDateKey } from '@/lib/metrics/format';

export const dynamic = 'force-dynamic';

const BADGE: Record<CpaJudgement, string> = {
  pass: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  over: 'bg-red-100 text-red-800',
  na: 'bg-slate-100 text-slate-500',
};
const ROW_TINT: Record<CpaJudgement, string> = {
  pass: '',
  warn: 'bg-amber-50/60',
  over: 'bg-red-50/60',
  na: '',
};

function Badge({ j }: { j: CpaJudgement }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[j]}`}>{JUDGEMENT_JA[j]}</span>;
}

const yen = (n: number) => formatYen(n);

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const thisMonth = jstDateKey(new Date()).slice(0, 7);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : thisMonth;
  const [{ result, lastUpdated }, months] = await Promise.all([getAdMonth(month), getKpiDailyMonths(thisMonth)]);
  const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">広告分析 — 媒体別広告費と広告費率</h1>
          <p className="text-xs text-slate-500">
            出典: Kintone 毎朝KPI報告(30) の日次取込（媒体別広告費・媒体別売上）。広告費率 = 広告費 ÷ 売上。判定は現場基準 目標{result.targetPct}%以下🟢／許容{result.limitPct}
            %以下🟡／超過🔴（docs/business.md §6）。
            {result.from && result.to ? ` 対象 ${result.from} 〜 ${result.to}（${result.dataDays}日分）` : ''}
            {lastUpdated ? ` ／ 最終取込 ${fmt(lastUpdated)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {months.map((m) => (
            <Link
              key={m}
              href={`/ads?month=${m}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${m === month ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'}`}
            >
              {m}
            </Link>
          ))}
        </div>
      </div>

      {result.dataDays === 0 ? (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-700">{month} の広告費・売上はまだ取り込まれていません。</p>
          <p className="mt-1 text-xs text-slate-500">
            毎朝11:20の「ダッシュボード取込」で KPI報告(30) の日次データが入ります。推測値は表示しません。合算CPA（スーツケース）は
            <Link href={`/ads/cpa?month=${month}`} className="ml-1 text-blue-900 underline">
              /ads/cpa
            </Link>
            で確認できます。
          </p>
        </div>
      ) : (
        <>
          {/* 月サマリー */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-slate-900 p-4 text-white shadow-sm">
              <p className="text-xs text-slate-300">月間広告費（{result.dataDays}日分）</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{yen(result.adTotal)}</p>
              <p className="text-[11px] text-slate-300">1日あたり {formatMetric(result.avgDailyAd, '円')}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">月間広告費率（広告費 ÷ 売上）</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-lg font-bold tabular-nums text-slate-900">{formatMetric(result.ratio, '%', 1)}</p>
                <Badge j={result.judgement} />
              </div>
              <p className="text-[11px] text-slate-500">売上 {yen(result.salesTotal)}（楽天＋Amazon＋自社）</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">日別判定の内訳</p>
              <p className="mt-1 text-sm tabular-nums text-slate-800">
                <span className="font-bold text-emerald-700">合格 {result.days.pass}日</span>
                <span className="mx-1 text-slate-300">／</span>
                <span className="font-bold text-amber-700">注意 {result.days.warn}日</span>
                <span className="mx-1 text-slate-300">／</span>
                <span className="font-bold text-red-700">超過 {result.days.over}日</span>
              </p>
              <p className="text-[11px] text-slate-500">{result.days.na > 0 ? `判定不可（売上0） ${result.days.na}日` : '全日が判定対象'}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">合算CPA（スーツケース）</p>
              <Link href={`/ads/cpa?month=${month}`} className="mt-1 inline-block text-sm font-bold text-blue-900 hover:underline">
                合算CPA管理を開く →
              </Link>
              <p className="text-[11px] text-slate-500">広告費 ÷ スーツケース販売個数。目標¥4,500／許容¥6,000 の判定と Excel 取込</p>
            </div>
          </div>

          {/* 媒体別 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {result.byMedia.map((m) => {
              const pct = m.share.kind === 'value' ? m.share.value : 0;
              return (
                <div key={m.key} className="rounded-xl bg-white p-4 shadow-sm">
                  <p className="text-xs text-slate-500">{m.label}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{yen(m.amount)}</p>
                  <p className="text-[11px] text-slate-500">構成比 {formatMetric(m.share, '%', 1)}</p>
                  <div className="mt-2 h-1.5 w-full rounded bg-slate-100">
                    <div className="h-1.5 rounded bg-slate-800" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 日別 */}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <div className="px-3 py-2">
              <h2 className="text-sm font-bold text-slate-800">日別 媒体別広告費・広告費率</h2>
              <p className="text-[11px] text-slate-500">7日移動 = 直近7暦日（当日含む・取込済みの日のみ）の広告費合計と、その Σ広告費 ÷ Σ売上。</p>
            </div>
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">日付</th>
                  <th className="px-2 py-2 text-right">売上</th>
                  {AD_MEDIA.map((m) => (
                    <th key={m.key} className="px-2 py-2 text-right">
                      {m.label}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">広告費合計</th>
                  <th className="px-2 py-2 text-right">広告費率</th>
                  <th className="px-2 py-2 text-left">判定</th>
                  <th className="px-2 py-2 text-right">7日移動 広告費</th>
                  <th className="px-2 py-2 text-right">7日移動 費率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.map((r) => (
                  <tr key={r.date} className={`hover:bg-slate-50 ${ROW_TINT[r.judgement]}`}>
                    <td className="px-3 py-1.5 tabular-nums text-slate-700">{r.date.slice(5).replace('-', '/')}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{yen(r.salesTotal)}</td>
                    {AD_MEDIA.map((m) => (
                      <td key={m.key} className={`px-2 py-1.5 text-right tabular-nums ${r.ad[m.key] === 0 ? 'text-slate-300' : 'text-slate-800'}`}>
                        {r.ad[m.key] === 0 ? '−' : yen(r.ad[m.key])}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">{yen(r.adTotal)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-900">{formatMetric(r.ratio, '%', 1)}</td>
                    <td className="px-2 py-1.5">
                      <Badge j={r.judgement} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                      {yen(r.moving7Ad)}
                      <span className="ml-1 text-[11px] text-slate-400">{r.moving7Days}日</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatMetric(r.moving7Ratio, '%', 1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
                <tr>
                  <td className="px-3 py-2">合計</td>
                  <td className="px-2 py-2 text-right tabular-nums">{yen(result.salesTotal)}</td>
                  {result.byMedia.map((m) => (
                    <td key={m.key} className="px-2 py-2 text-right tabular-nums">
                      {yen(m.amount)}
                      <div className="font-normal text-slate-500">{formatMetric(m.share, '%', 1)}</div>
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums">{yen(result.adTotal)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMetric(result.ratio, '%', 1)}</td>
                  <td className="px-2 py-2">
                    <Badge j={result.judgement} />
                  </td>
                  <td className="px-2 py-2"></td>
                  <td className="px-2 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            媒体の「−」は当日の広告費が0（未入力を含む）。Amazon広告CSVが未添付の日は KPI報告側で0のまま取り込まれるため、合算CPA管理のメモも参照してください。
          </p>
        </>
      )}

      {/* 未取得の指標 */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">未取得の指標（データ連携待ち）</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          媒体報告（帰属売上・クリック・表示回数・媒体CV）の取込が無いため表示しません。総売上÷広告費で代用しません（docs/metrics.md）。接続は
          <Link href="/integrations" className="ml-1 text-blue-900 underline">
            データ連携設定
          </Link>
          。
        </p>
        <table className="mt-2 w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 text-left">指標</th>
              <th className="py-1 text-left">式</th>
              <th className="py-1 text-left">状態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {AD_UNAVAILABLE_METRICS.map((m) => (
              <tr key={m.label}>
                <td className="py-1 font-medium text-slate-700">{m.label}</td>
                <td className="py-1 text-slate-500">{m.formula}</td>
                <td className="py-1 text-slate-500">{m.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
