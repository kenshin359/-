import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions, canWrite } from '@/lib/auth';
import { getCpaMonth, getCpaMonths } from '@/lib/cpa-data';
import { JUDGEMENT_JA, monthDates, type CpaDayResult, type CpaJudgement } from '@/lib/metrics/cpa';
import { formatMetric, formatYen, jstDateKey } from '@/lib/metrics/format';
import { CpaChart, DayEditor, ImportForm, ThresholdsForm } from './ui';

export const dynamic = 'force-dynamic';

const BADGE: Record<CpaJudgement, string> = {
  pass: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  over: 'bg-red-100 text-red-800',
  na: 'bg-slate-100 text-slate-500',
};

function Badge({ j }: { j: CpaJudgement }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[j]}`}>{JUDGEMENT_JA[j]}</span>;
}

function num(v: number | null | undefined): string {
  return v == null ? '−' : v.toLocaleString('ja-JP');
}

export default async function CpaPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const writer = canWrite(session.user.role);
  const admin = session.user.role === 'admin';

  const thisMonth = jstDateKey(new Date()).slice(0, 7);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : thisMonth;
  const [{ thresholds, result, notes, lastUpdated }, months] = await Promise.all([getCpaMonth(month), getCpaMonths(thisMonth)]);
  const byDate = new Map(result.rows.map((r) => [r.date, r]));
  const dates = monthDates(month);
  const today = jstDateKey(new Date());

  const chart = dates
    .filter((d) => d <= today || byDate.has(d))
    .map((d) => {
      const r = byDate.get(d);
      return {
        day: String(Number(d.slice(8))),
        cpa: r && r.cpa.kind === 'value' ? Math.round(r.cpa.value) : null,
        moving7: r && r.moving7.kind === 'value' ? Math.round(r.moving7.value) : null,
      };
    });

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800">合算CPA（スーツケース）</h1>
            <p className="mt-1 text-xs text-slate-500">
              広告費（メタ＋Amazon広告＋RPP＋Google＋その他）÷ スーツケース販売個数（全チャネル）。
              判定: 合格 ≤ {formatYen(result.targetCpa)} ／ 注意 ≤ {formatYen(result.limitCpa)} ／ 超過はそれ以上。
              広告比率は目標{Math.round(thresholds.targetRatio * 100)}%・許容{Math.round(thresholds.limitRatio * 100)}%。
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-slate-500">対象月</span>
            {months.map((m) => (
              <Link
                key={m}
                href={`/ads/cpa?month=${m}`}
                className={`rounded-md px-2 py-1 ${m === month ? 'bg-blue-900 text-white' : 'border border-slate-300 hover:bg-slate-50'}`}
              >
                {m}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="月間 合算CPA" value={formatMetric(result.cpa, '円', 0)} badge={result.judgement} sub={`入力 ${result.filledDays}日`} />
          <Card label="月間 広告比率" value={formatMetric(result.ratio, '%', 1)} badge={result.ratioJudgement} sub="広告費 ÷ スーツケース売上" />
          <Card label="合算広告費 累計" value={formatYen(result.adTotal)} sub={`メタ ${num(result.byMedia.meta)} / AZ ${num(result.byMedia.amazonAds)} / RPP ${num(result.byMedia.rpp)} / G ${num(result.byMedia.google)}`} />
          <Card label="販売個数 累計" value={`${num(result.units)}個`} sub={`AZ ${num(result.byChannel.amazon)} / 楽天 ${num(result.byChannel.rakuten)} / 自社 ${num(result.byChannel.own)}`} />
          <Card label="スーツケース売上 累計（税込）" value={result.sales == null ? '未取得' : formatYen(result.sales)} />
          <Card label="合格の日数" value={`${result.days.pass}日`} badge="pass" />
          <Card label="注意の日数" value={`${result.days.warn}日`} badge="warn" />
          <Card label="超過の日数" value={`${result.days.over}日`} badge="over" />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          最終更新: {lastUpdated ? lastUpdated.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '未入力'}
          ／ 判定基準は管理者が下部で変更できます
        </p>
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">日別 合算CPA の推移</h2>
        {chart.some((c) => c.cpa != null) ? (
          <CpaChart data={chart} target={result.targetCpa} limit={result.limitCpa} />
        ) : (
          <p className="mt-2 text-sm text-slate-500">この月のデータはまだありません。下の「Excelから貼り付けて取込」か、日別の「入力」から登録してください。</p>
        )}
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">日別</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="py-2 pr-2">日付</th>
                <th className="py-2 pr-2 text-right">売上(税込)</th>
                <th className="py-2 pr-2 text-right">合算広告費</th>
                <th className="py-2 pr-2 text-right">広告比率</th>
                <th className="py-2 pr-2 text-right">合算CPA</th>
                <th className="py-2 pr-2">判定</th>
                <th className="py-2 pr-2 text-right">メタ</th>
                <th className="py-2 pr-2 text-right">AZ広告</th>
                <th className="py-2 pr-2 text-right">RPP</th>
                <th className="py-2 pr-2 text-right">Google</th>
                <th className="py-2 pr-2 text-right">他</th>
                <th className="py-2 pr-2 text-right">AZ個</th>
                <th className="py-2 pr-2 text-right">楽天個</th>
                <th className="py-2 pr-2 text-right">自社個</th>
                <th className="py-2 pr-2 text-right">合計個</th>
                <th className="py-2 pr-2 text-right">7日移動</th>
                <th className="py-2">メモ／操作</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const r: CpaDayResult | undefined = byDate.get(d);
                const n = notes.get(d);
                const future = d > today && !r;
                return (
                  <tr key={d} className={`border-b border-slate-100 align-top ${future ? 'text-slate-300' : ''}`}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{Number(d.slice(5, 7))}/{Number(d.slice(8))}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? (r.suitcaseSales == null ? <span className="text-slate-400">未取得</span> : num(r.suitcaseSales)) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r && !r.empty ? num(r.adTotal) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r && !r.empty ? formatMetric(r.ratio, '%', 1) : ''}</td>
                    <td className="py-1.5 pr-2 text-right font-medium tabular-nums">{r && !r.empty ? formatMetric(r.cpa, '円', 0) : ''}</td>
                    <td className="py-1.5 pr-2">{r && !r.empty ? <Badge j={r.judgement} /> : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? num(byDateRaw(r, 'meta')) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? num(byDateRaw(r, 'amazonAds')) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? num(byDateRaw(r, 'rpp')) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? num(byDateRaw(r, 'google')) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? num(byDateRaw(r, 'other')) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? num(byDateRaw(r, 'unitsAmazon')) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? num(byDateRaw(r, 'unitsRakuten')) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r ? num(byDateRaw(r, 'unitsOwn')) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r && !r.empty ? num(r.units) : ''}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{r && !r.empty ? formatMetric(r.moving7, '円', 0) : ''}</td>
                    <td className="py-1.5">
                      {n?.note && <p className="mb-1 text-[11px] text-slate-500">{n.note}</p>}
                      <DayEditor
                        canWrite={writer}
                        v={{
                          date: d,
                          suitcaseSales: r?.suitcaseSales ?? null,
                          meta: byDateRaw(r, 'meta'),
                          amazonAds: byDateRaw(r, 'amazonAds'),
                          rpp: byDateRaw(r, 'rpp'),
                          google: byDateRaw(r, 'google'),
                          other: byDateRaw(r, 'other'),
                          unitsAmazon: byDateRaw(r, 'unitsAmazon'),
                          unitsRakuten: byDateRaw(r, 'unitsRakuten'),
                          unitsOwn: byDateRaw(r, 'unitsOwn'),
                          note: n?.note ?? '',
                          exists: Boolean(r),
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-2 pr-2">合計</td>
                <td className="py-2 pr-2 text-right tabular-nums">{result.sales == null ? '−' : num(result.sales)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.adTotal)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatMetric(result.ratio, '%', 1)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatMetric(result.cpa, '円', 0)}</td>
                <td className="py-2 pr-2"><Badge j={result.judgement} /></td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.byMedia.meta)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.byMedia.amazonAds)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.byMedia.rpp)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.byMedia.google)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.byMedia.other)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.byChannel.amazon)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.byChannel.rakuten)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.byChannel.own)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(result.units)}</td>
                <td className="py-2 pr-2"></td>
                <td className="py-2"></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          ※スーツケース売上＝売上明細のスーツケース系（S/M/L・クラシックアルミ・多機能アルミ・ジップ等）の税込売上（全チャネル）。メタ＝トラベル＋カタログ（リベティ分）。
          Amazon広告CSVが未添付の日は空欄のまま保存し、メモに残す（古いデータで埋めない）。
        </p>
      </div>

      {writer && (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">Excelから貼り付けて取込（{month}）</h2>
          <p className="mb-2 mt-1 text-xs text-slate-500">
            「合算CPA Excel」の「日次」シートを見出し行ごと選択してコピー → 下に貼り付け → 取り込む。数式列（合算広告費・広告比率・合算CPA・判定・7日移動）は無視され、保存後にこの画面で再計算します。
          </p>
          <ImportForm month={month} />
        </div>
      )}

      {admin && (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">判定基準（管理者）</h2>
          <p className="mb-2 mt-1 text-xs text-slate-500">
            目標CPA＝客単価×目標比率、許容CPA＝客単価×許容比率。変更は全月の判定に反映されます（過去データは書き換えません）。
          </p>
          <ThresholdsForm aov={thresholds.aov} targetPct={+(thresholds.targetRatio * 100).toFixed(2)} limitPct={+(thresholds.limitRatio * 100).toFixed(2)} />
        </div>
      )}
    </div>
  );
}

function Card({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: CpaJudgement }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-lg font-bold tabular-nums text-slate-800">{value}</p>
        {badge && <Badge j={badge} />}
      </div>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

// 表示用: 日次結果に元の内訳を持たせていないため、ページ側で取り直さず result.rows の raw を参照する
function byDateRaw(r: CpaDayResult | undefined, key: 'meta' | 'amazonAds' | 'rpp' | 'google' | 'other' | 'unitsAmazon' | 'unitsRakuten' | 'unitsOwn'): number {
  return r?.raw?.[key] ?? 0;
}
