// 在庫管理（STANDARD）: SKU×倉庫の在庫表。集計は src/lib/metrics/inventory.ts のみ。
// 実データ（demo=false の InventoryMove）が無い間は「未接続」を正直に表示し、必要な紐付け（docs/integrations.md A7）を示す。
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getInventoryOverview } from '@/lib/inventory-data';
import { LOW_STOCK_THRESHOLD, type StockFlag } from '@/lib/metrics/inventory';
import { integrationLabel } from '@/lib/site-map';

export const dynamic = 'force-dynamic';

const num = (n: number) => n.toLocaleString('ja-JP');

const FLAG_CLS: Record<StockFlag, string> = {
  欠品: 'bg-red-100 text-red-800',
  FBA切れ: 'bg-orange-100 text-orange-800',
  CS切れ: 'bg-orange-100 text-orange-800',
  残りわずか: 'bg-amber-100 text-amber-800',
  マイナス在庫: 'bg-slate-200 text-slate-800',
};

const AFTER_CONNECT = [
  { item: '在庫個数（FBA／CS 別）', src: 'Kintone 在庫報告(35)' },
  { item: '末端価格', src: 'Kintone 在庫報告(35)' },
  { item: '在庫金額 = 在庫個数 × 末端価格', src: '集計（docs/integrations.md A7）' },
  { item: 'FBA切れ／CS切れ／欠品／残りわずか（10個以下）の判定', src: 'docs/business.md §6「在庫」' },
  { item: '入荷予定', src: 'Kintone 在庫報告(35)' },
];

export default async function InventoryPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const { table, moveCount, demoMoveCount, warehouses, realWarehouses, skuTotal } = await getInventoryOverview();
  const connected = moveCount > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">在庫管理 — SKU × 倉庫</h1>
          <p className="text-xs text-slate-500">
            出典: ダッシュボードDBの入出庫（InventoryMove）。在庫数 = 入庫（正）＋出庫（負）の合計。demo データは常に除外。
            {table.lastMoveDate ? ` ／ 最終の動き ${table.lastMoveDate}` : ''}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
          {connected ? '実データあり' : '未接続'}
        </span>
      </div>

      {!connected ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">未接続: Kintone 在庫報告(35) のAPIトークン待ち</p>
            <p className="mt-1 text-xs text-slate-600">
              必要な紐付け: <span className="font-medium text-slate-800">{integrationLabel('A7')}</span>
              。A7 は {integrationLabel('A4')} の後に着手します（同じトークンで読み取り）。
            </p>
            <p className="mt-1 text-xs text-slate-500">
              現在DBにある実データの入出庫は {num(moveCount)} 件（demo {num(demoMoveCount)} 件は除外）。推測値は表示しません。
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">接続後に出る項目</th>
                    <th className="px-3 py-2 text-left">データ源</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {AFTER_CONNECT.map((r) => (
                    <tr key={r.item}>
                      <td className="px-3 py-1.5 text-slate-800">{r.item}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-500">{r.src}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800">マスターの状態</h2>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              <li>
                倉庫: {warehouses.length === 0 ? '未登録' : warehouses.map((w) => `${w.name}（${w.code}）`).join('、')}
                {realWarehouses.length === 0 && warehouses.length > 0 && <span className="ml-1 text-slate-400">— デモ倉庫のみ</span>}
              </li>
              <li>
                実運用は FBA在庫（Amazon用）と CS在庫（倉庫＋事務所。楽天・自社用）の2倉庫で別判断（docs/business.md §3・G-9）。接続時に倉庫コードを <code className="rounded bg-slate-100 px-1">fba</code> ／ <code className="rounded bg-slate-100 px-1">cs</code> で登録します。
              </li>
              <li>SKU: {num(skuTotal)} 件登録（内訳は <Link href="/masters" className="text-blue-800 hover:underline">各種マスター管理</Link>）。</li>
            </ul>
          </div>
        </>
      ) : (
        <>
          {/* 倉庫別合計と異常件数 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {table.warehouses.map((w) => (
              <div key={w.code} className="rounded-xl bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">
                  {w.name} <span className="text-slate-400">({w.code})</span>
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{num(table.totals[w.code] ?? 0)}個</p>
              </div>
            ))}
            <div className="rounded-xl bg-slate-900 p-4 text-white shadow-sm">
              <p className="text-xs text-slate-300">合計（{num(table.lines.length)} SKU）</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{num(table.grandTotal)}個</p>
              <p className="text-[11px] text-slate-300">在庫金額: 未取得（末端価格は在庫報告(35)から）</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(table.flagCounts) as StockFlag[]).map((f) => (
              <span key={f} className={`rounded-full px-2.5 py-0.5 font-medium ${table.flagCounts[f] > 0 ? FLAG_CLS[f] : 'bg-slate-50 text-slate-400'}`}>
                {f} {num(table.flagCounts[f])}
              </span>
            ))}
            <span className="text-slate-500">基準: 残りわずか = {LOW_STOCK_THRESHOLD}個以下、欠品 = 全倉庫0（docs/business.md §6）</span>
          </div>

          {/* SKU × 倉庫 */}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-2 py-2 text-left">シリーズ</th>
                  {table.warehouses.map((w) => (
                    <th key={w.code} className="px-2 py-2 text-right">
                      {w.name}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">合計</th>
                  <th className="px-2 py-2 text-left">判定</th>
                  <th className="px-2 py-2 text-right">最終の動き</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {table.lines.map((l) => (
                  <tr key={l.skuCode} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-slate-800">{l.skuName}</div>
                      <div className="text-[11px] text-slate-400">{l.skuCode}</div>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">{l.seriesName}</td>
                    {table.warehouses.map((w) => (
                      <td key={w.code} className={`px-2 py-1.5 text-right tabular-nums ${(l.byWarehouse[w.code] ?? 0) <= 0 ? 'text-red-700' : 'text-slate-800'}`}>
                        {num(l.byWarehouse[w.code] ?? 0)}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">{num(l.total)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {l.flags.length === 0 ? (
                          <span className="text-xs text-slate-400">−</span>
                        ) : (
                          l.flags.map((f) => (
                            <span key={f} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${FLAG_CLS[f]}`}>
                              {f}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-500">{l.lastMoveDate}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>
                    合計
                  </td>
                  {table.warehouses.map((w) => (
                    <td key={w.code} className="px-2 py-2 text-right tabular-nums">
                      {num(table.totals[w.code] ?? 0)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums">{num(table.grandTotal)}</td>
                  <td className="px-2 py-2" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            在庫金額・末端価格・在庫日数は在庫報告(35) 接続後に出ます（{integrationLabel('A7')}）。demo {num(demoMoveCount)} 件は除外。
          </p>
        </>
      )}
    </div>
  );
}
