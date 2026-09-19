// 新商品・仕入れ（STANDARD）: 仕入れ案件（PurchaseOrder／PoLine／Supplier）の一覧。集計は src/lib/metrics/purchasing.ts のみ。
// 実データ（demo=false）が無い間は「未接続」を正直に表示し、入荷予定の登録は Kintone 在庫報告(35) が正であることを案内する。
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getPurchasingOverview } from '@/lib/purchasing-data';
import { ACTIVE_STAGES, isPoStage, PO_STAGE_JA, poAmountJpy, poQty } from '@/lib/metrics/purchasing';
import { formatMetric, jstDateKey } from '@/lib/metrics/format';
import { integrationLabel } from '@/lib/site-map';

export const dynamic = 'force-dynamic';

const num = (n: number) => n.toLocaleString('ja-JP');

const AFTER_CONNECT = [
  { item: '案件一覧（案件番号・仕入先・段階・担当・入荷予定日・メモ）', src: 'PurchaseOrder（登録元は Kintone 在庫報告(35) の入荷予定）' },
  { item: '明細（SKU・数量・単価・通貨・円換算）', src: 'PoLine' },
  { item: '段階別の件数（リサーチ→見積→サンプル→テスト販売→発注済→生産中→出荷済→入荷済）', src: 'prisma/schema.prisma の status 定義' },
  { item: '入荷予定の残日数と遅延件数', src: 'etaDate と当日（JST）の差' },
];

export default async function PurchasingPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const today = jstDateKey(new Date());
  const { rows, summary, demoCount, realSuppliers } = await getPurchasingOverview(today);
  const connected = rows.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">新商品・仕入れ — 案件パイプライン</h1>
          <p className="text-xs text-slate-500">出典: ダッシュボードDBの仕入れ案件（PurchaseOrder／PoLine／Supplier）。demo データは常に除外。基準日 {today}（JST）。</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
          {connected ? '実データあり' : '未接続'}
        </span>
      </div>

      {!connected ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">未接続: 実データの仕入れ案件はまだありません</p>
            <p className="mt-1 text-xs text-slate-600">
              入荷予定の登録は <span className="font-medium text-slate-800">Kintone 在庫報告(35)</span> が正です（docs/business.md §7.1）。ダッシュボードには取込で入り、この画面では登録・編集しません。
            </p>
            <p className="mt-1 text-xs text-slate-600">
              必要な紐付け: <span className="font-medium text-slate-800">{integrationLabel('A7')}</span>。
            </p>
            <p className="mt-1 text-xs text-slate-500">
              現在DBにある案件: 実データ {num(rows.length)} 件（demo {num(demoCount)} 件は除外）／ 実データの仕入先: {realSuppliers.length === 0 ? '未登録' : realSuppliers.map((s) => s.name).join('、')}。推測値は表示しません。
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
          <p className="text-[11px] text-slate-500">
            仕入先・SKU のマスター件数は <Link href="/masters" className="text-blue-800 hover:underline">各種マスター管理</Link>、在庫は <Link href="/inventory" className="text-blue-800 hover:underline">在庫管理</Link> へ。
          </p>
        </>
      ) : (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">進行中の案件</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{num(summary.activeCount)}件</p>
              <p className="text-[11px] text-slate-500">入荷済・アーカイブ以外</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">進行中の数量</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{num(summary.activeQty)}個</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">進行中の金額（円換算）</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{formatMetric(summary.activeAmountJpy, '円')}</p>
              <p className="text-[11px] text-slate-500">数量×単価。外貨は fxRate で換算</p>
            </div>
            <div className={`rounded-xl p-4 shadow-sm ${summary.overdueCount > 0 ? 'bg-red-50' : 'bg-white'}`}>
              <p className="text-xs text-slate-500">入荷予定の遅延</p>
              <p className={`mt-1 text-lg font-bold tabular-nums ${summary.overdueCount > 0 ? 'text-red-700' : 'text-slate-900'}`}>{num(summary.overdueCount)}件</p>
              <p className="text-[11px] text-slate-500">予定日が基準日より前の進行中案件</p>
            </div>
          </div>

          {/* 段階別 */}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800">段階別の件数</h2>
            <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-9">
              {summary.byStage.map((s) => (
                <div key={s.status} className={`rounded-lg p-2 text-center ${ACTIVE_STAGES.includes(s.status) ? 'bg-slate-50' : 'bg-slate-100/60'}`}>
                  <p className="text-[11px] text-slate-500">{s.label}</p>
                  <p className={`text-base font-bold tabular-nums ${s.count > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{num(s.count)}</p>
                </div>
              ))}
            </div>
            {summary.unknownStatus > 0 && <p className="mt-2 text-[11px] text-amber-700">定義外の段階の案件が {num(summary.unknownStatus)} 件あります（表には出しますが段階集計には入れません）。</p>}
          </div>

          {/* 入荷予定 */}
          {summary.upcoming.length > 0 && (
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
              <div className="px-3 py-2">
                <h2 className="text-sm font-bold text-slate-800">入荷予定（進行中・日付順）</h2>
              </div>
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">予定日</th>
                    <th className="px-2 py-2 text-right">残日数</th>
                    <th className="px-2 py-2 text-left">案件</th>
                    <th className="px-2 py-2 text-left">仕入先</th>
                    <th className="px-2 py-2 text-left">段階</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.upcoming.map((u) => (
                    <tr key={u.poNo} className={u.daysLeft < 0 ? 'bg-red-50' : ''}>
                      <td className="px-3 py-1.5 tabular-nums text-slate-800">{u.etaDate}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${u.daysLeft < 0 ? 'font-semibold text-red-700' : 'text-slate-700'}`}>{u.daysLeft < 0 ? `${num(-u.daysLeft)}日遅れ` : `${num(u.daysLeft)}日`}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-800">{u.poNo}</td>
                      <td className="px-2 py-1.5 text-slate-700">{u.supplierName}</td>
                      <td className="px-2 py-1.5 text-xs text-slate-600">{isPoStage(u.status) ? PO_STAGE_JA[u.status] : u.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 案件一覧 */}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <div className="px-3 py-2">
              <h2 className="text-sm font-bold text-slate-800">案件一覧（{num(rows.length)} 件）</h2>
            </div>
            <table className="w-full min-w-[840px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">案件</th>
                  <th className="px-2 py-2 text-left">仕入先</th>
                  <th className="px-2 py-2 text-left">段階</th>
                  <th className="px-2 py-2 text-left">担当</th>
                  <th className="px-2 py-2 text-left">入荷予定</th>
                  <th className="px-2 py-2 text-left">明細（SKU × 数量）</th>
                  <th className="px-2 py-2 text-right">数量</th>
                  <th className="px-2 py-2 text-right">金額（円換算）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.poNo} className="align-top hover:bg-slate-50">
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-slate-800">{p.poNo}</div>
                      {p.memo && <div className="text-[11px] text-slate-400">{p.memo}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">{p.supplierName}</td>
                    <td className="px-2 py-1.5">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{isPoStage(p.status) ? PO_STAGE_JA[p.status] : p.status}</span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">{p.assignee ?? '−'}</td>
                    <td className="px-2 py-1.5 text-xs tabular-nums text-slate-600">{p.etaDate ?? '未設定'}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">
                      {p.lines.map((l) => (
                        <div key={l.skuCode}>
                          {l.skuName} <span className="text-slate-400">({l.skuCode})</span> × {num(l.qty)}
                          {l.received && <span className="ml-1 text-emerald-700">入庫済</span>}
                        </div>
                      ))}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{num(poQty(p))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">{formatMetric(poAmountJpy(p), '円')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">登録・編集は Kintone 在庫報告(35) で行います（Kintone が正）。demo {num(demoCount)} 件は除外。</p>
        </>
      )}
    </div>
  );
}
