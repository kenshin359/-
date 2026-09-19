// 商品分析（STANDARD）: 商品別 × チャネル別（Amazon／楽天／自社サイト／その他）の売上。
// 集計は src/lib/metrics/product-sales.ts のみ（画面で独自計算しない）。元データは Kintone 売上明細(29) の取込。
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getProductSalesMonth, getProductSalesMonths, getProductSeries } from '@/lib/product-sales-data';
import { CHANNELS, type ChannelCell } from '@/lib/metrics/product-sales';
import { formatMetric, formatYen, jstDateKey } from '@/lib/metrics/format';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const num = (n: number) => n.toLocaleString('ja-JP');

function Cell({ c, grand }: { c: ChannelCell; grand: number }) {
  if (c.amount === 0 && c.units === 0) return <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">−</td>;
  const pct = grand > 0 ? (c.amount / grand) * 100 : 0;
  return (
    <td className="px-2 py-1.5 text-right tabular-nums">
      <div className="font-medium text-slate-800">{yen(c.amount)}</div>
      <div className="text-[11px] text-slate-500">
        {num(c.units)}個{grand > 0 && <span className="ml-1 text-slate-400">{pct.toFixed(0)}%</span>}
      </div>
    </td>
  );
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ month?: string; product?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const thisMonth = jstDateKey(new Date()).slice(0, 7);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : thisMonth;
  const [{ rows, matrix, lastUpdated }, months] = await Promise.all([getProductSalesMonth(month), getProductSalesMonths(thisMonth)]);
  const selected = sp.product && matrix.lines.some((l) => l.product === sp.product) ? sp.product : null;
  const series = selected ? getProductSeries(rows, selected) : [];
  const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">商品分析 — 商品別 × チャネル別売上</h1>
          <p className="text-xs text-slate-500">
            出典: Kintone 売上明細(29)（税込）。チャネルは Amazon／楽天／自社サイト／その他 の4区分。
            {matrix.from && matrix.to ? ` 対象 ${matrix.from} 〜 ${matrix.to}（${matrix.days}日分）` : ''}
            {lastUpdated ? ` ／ 最終取込 ${fmt(lastUpdated)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {months.map((m) => (
            <Link
              key={m}
              href={`/products?month=${m}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${m === month ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'}`}
            >
              {m}
            </Link>
          ))}
        </div>
      </div>

      {matrix.lines.length === 0 ? (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-700">{month} の商品別売上はまだ取り込まれていません。</p>
          <p className="mt-1 text-xs text-slate-500">毎朝11:20の「ダッシュボード取込」で入ります。手動で入れる場合は「月次SKU別まとめ」を対象月で実行してください。推測値は表示しません。</p>
        </div>
      ) : (
        <>
          {/* チャネル別の合計 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {CHANNELS.map((ch) => {
              const c = matrix.channelTotals[ch];
              const pct = matrix.grand.amount > 0 ? (c.amount / matrix.grand.amount) * 100 : 0;
              return (
                <div key={ch} className="rounded-xl bg-white p-4 shadow-sm">
                  <p className="text-xs text-slate-500">{ch}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{yen(c.amount)}</p>
                  <p className="text-[11px] text-slate-500">
                    {num(c.units)}個 ／ 構成比 {pct.toFixed(1)}%
                  </p>
                  <div className="mt-2 h-1.5 w-full rounded bg-slate-100">
                    <div className="h-1.5 rounded bg-slate-800" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="rounded-xl bg-slate-900 p-4 text-white shadow-sm">
              <p className="text-xs text-slate-300">合計（全商品）</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{yen(matrix.grand.amount)}</p>
              <p className="text-[11px] text-slate-300">
                {num(matrix.grand.units)}個 ／ 客単価 {matrix.grand.units > 0 ? yen(matrix.grand.amount / matrix.grand.units) : '個数0'}
              </p>
            </div>
          </div>
          {matrix.otherRawChannels.length > 0 && (
            <p className="text-[11px] text-slate-500">「その他」に含めた表記: {matrix.otherRawChannels.join('、')}</p>
          )}

          {/* 商品 × チャネル */}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">商品</th>
                  {CHANNELS.map((ch) => (
                    <th key={ch} className="px-2 py-2 text-right">
                      {ch}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">合計</th>
                  <th className="px-2 py-2 text-right">構成比</th>
                  <th className="px-2 py-2 text-right">客単価</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matrix.lines.map((l) => (
                  <tr key={l.product} className={`hover:bg-slate-50 ${selected === l.product ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-1.5">
                      <Link href={`/products?month=${month}&product=${encodeURIComponent(l.product)}`} className="font-medium text-slate-800 hover:underline">
                        {l.product}
                      </Link>
                    </td>
                    {CHANNELS.map((ch) => (
                      <Cell key={ch} c={l.byChannel[ch]} grand={l.total.amount} />
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <div className="font-semibold text-slate-900">{yen(l.total.amount)}</div>
                      <div className="text-[11px] text-slate-500">{num(l.total.units)}個</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{formatMetric(l.share, '%', 1)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{formatMetric(l.aov, '円')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
                <tr>
                  <td className="px-3 py-2">合計</td>
                  {CHANNELS.map((ch) => (
                    <td key={ch} className="px-2 py-2 text-right tabular-nums">
                      {yen(matrix.channelTotals[ch].amount)}
                      <div className="font-normal text-slate-500">{num(matrix.channelTotals[ch].units)}個</div>
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums">
                    {yen(matrix.grand.amount)}
                    <div className="font-normal text-slate-500">{num(matrix.grand.units)}個</div>
                  </td>
                  <td className="px-2 py-2 text-right">100%</td>
                  <td className="px-2 py-2 text-right tabular-nums">{matrix.grand.units > 0 ? formatYen(matrix.grand.amount / matrix.grand.units) : '個数0'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">各セルの%は、その商品の売上に占めるチャネルの割合。商品名を押すと日別の推移が下に出ます。</p>

          {/* 日別（選択した商品） */}
          {selected && (
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
              <div className="flex items-center justify-between px-3 py-2">
                <h2 className="text-sm font-bold text-slate-800">{selected} の日別売上（チャネル別）</h2>
                <Link href={`/products?month=${month}`} className="text-xs text-slate-500 hover:underline">
                  閉じる
                </Link>
              </div>
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">日付</th>
                    {CHANNELS.map((ch) => (
                      <th key={ch} className="px-2 py-2 text-right">
                        {ch}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right">合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {series.map((p) => (
                    <tr key={p.date}>
                      <td className="px-3 py-1.5 tabular-nums text-slate-700">{p.date.slice(5).replace('-', '/')}</td>
                      {CHANNELS.map((ch) => (
                        <Cell key={ch} c={p.byChannel[ch]} grand={0} />
                      ))}
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                        {yen(p.total.amount)}
                        <div className="text-[11px] font-normal text-slate-500">{num(p.total.units)}個</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
