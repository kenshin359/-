// PRO: 制作依頼ボード（LP・広告の画像作成依頼シートの可視化）。
// 数字は src/lib/metrics/creative-requests.ts の集計のみ。シートが正（ダッシュボードは読むだけ。状態変更はシートで行う）。
import type { Metadata } from 'next';
import { requireActor } from '@/lib/rbac';
import { getCreativeData } from '@/lib/creative-data';
import { STATUS_JA, STATUS_ORDER, isOverdue, sortOpen, type CreativeRequest, type CreativeStatus } from '@/lib/metrics/creative-requests';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '制作依頼ボード' };

const STATUS_CLS: Record<CreativeStatus, string> = {
  requested: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-800',
  review: 'bg-amber-100 text-amber-800',
  revise: 'bg-purple-100 text-purple-800',
  done: 'bg-emerald-100 text-emerald-800',
};

function md(d: string | null): string {
  return d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '—';
}

function Due({ r, today }: { r: CreativeRequest; today: string }) {
  if (r.status === 'done') return <span className="text-slate-400">{r.dueDate ? md(r.dueDate) : r.dueRaw || '—'}</span>;
  if (isOverdue(r, today)) return <span className="font-semibold text-red-700">{md(r.dueDate)} 超過</span>;
  if (r.dueDate === today) return <span className="font-semibold text-amber-700">本日</span>;
  if (r.dueDate) return <span className="text-slate-800">{md(r.dueDate)}</span>;
  return <span className="text-slate-400">{r.dueRaw ? `${r.dueRaw}（日付不明）` : '未記入'}</span>;
}

export default async function CreativePage() {
  await requireActor();
  const data = await getCreativeData();
  const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

  if (data.status === 'unavailable') {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-bold text-slate-800">制作依頼ボード</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">未接続</p>
          <p className="mt-1">{data.reason}</p>
          {data.sheetUrl && (
            <a href={data.sheetUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">
              シートを開く
            </a>
          )}
        </div>
      </div>
    );
  }

  const { today, list, summary, sheetUrl, fetchedAt } = data;
  const open = sortOpen(list, today);
  const recentDone = list
    .filter((r) => r.status === 'done')
    .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? '') || b.rowNo - a.rowNo)
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">制作依頼ボード — LP・広告の画像作成依頼</h1>
          <p className="text-xs text-slate-500">
            出典: 画像作成依頼シート（Googleスプレッドシート・タブ「依頼シート」）。最終取得 {fmt(fetchedAt)}。状態の変更・新しい依頼はシートで行います（5分以内に反映）。
          </p>
        </div>
        <a href={sheetUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
          シートを開く ↗
        </a>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { l: '未完了', v: summary.open, cls: 'text-slate-900' },
          { l: '納期超過', v: summary.overdue, cls: summary.overdue > 0 ? 'text-red-700' : 'text-emerald-700' },
          { l: '本日納期', v: summary.dueToday, cls: summary.dueToday > 0 ? 'text-amber-700' : 'text-slate-900' },
          { l: '作成者 未定', v: summary.unassigned, cls: summary.unassigned > 0 ? 'text-amber-700' : 'text-slate-900' },
          { l: '納期 不明（未完了）', v: summary.dueUnknown, cls: 'text-slate-900' },
        ].map((t) => (
          <div key={t.l} className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t.l}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${t.cls}`}>{t.v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">状態別</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {STATUS_ORDER.map((s) => (
              <li key={s} className="flex items-center justify-between">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[s]}`}>{STATUS_JA[s]}</span>
                <span className="tabular-nums text-slate-800">{summary.byStatus[s]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">作成者別の抱え数（未完了）</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.byDesigner.length === 0 && <li className="text-slate-400">未完了なし</li>}
            {summary.byDesigner.map((d) => (
              <li key={d.designer} className="flex items-center justify-between">
                <span className="text-slate-800">{d.designer}</span>
                <span className="tabular-nums text-slate-800">
                  {d.open}
                  {d.overdue > 0 && <span className="ml-1 text-xs text-red-700">（超過 {d.overdue}）</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">依頼者別（未完了）</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.byRequester.length === 0 && <li className="text-slate-400">未完了なし</li>}
            {summary.byRequester.map((d) => (
              <li key={d.requester} className="flex items-center justify-between">
                <span className="text-slate-800">{d.requester}</span>
                <span className="tabular-nums text-slate-800">{d.open}</span>
              </li>
            ))}
          </ul>
          {summary.duplicateNos.length > 0 && <p className="mt-2 text-[11px] text-amber-700">NO. が重複しています: {summary.duplicateNos.join('、')}（シートで振り直してください）</p>}
        </div>
      </div>

      {/* 未完了一覧 */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <div className="px-3 py-2">
          <h2 className="text-sm font-bold text-slate-800">未完了の依頼（納期超過 → 本日 → 納期順）</h2>
        </div>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left">NO.</th>
              <th className="px-2 py-2 text-left">状態</th>
              <th className="px-2 py-2 text-left">納期</th>
              <th className="px-2 py-2 text-left">依頼日</th>
              <th className="px-2 py-2 text-left">依頼者</th>
              <th className="px-2 py-2 text-left">作成者</th>
              <th className="px-2 py-2 text-left">媒体／用途</th>
              <th className="px-2 py-2 text-left">対象商品</th>
              <th className="px-2 py-2 text-left">内容</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {open.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-slate-400">
                  未完了の依頼はありません
                </td>
              </tr>
            )}
            {open.map((r) => (
              <tr key={`${r.no}-${r.rowNo}`} className={isOverdue(r, today) ? 'bg-red-50/60' : ''}>
                <td className="px-2 py-1.5 tabular-nums text-slate-700">{r.no || `行${r.rowNo}`}</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[r.status]}`}>{STATUS_JA[r.status]}</span>
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <Due r={r} today={today} />
                  {r.dueKind !== 'date' && r.dueRaw && r.dueDate && <div className="text-[11px] text-slate-400">「{r.dueRaw}」</div>}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-slate-700">{md(r.requestedAt)}</td>
                <td className="px-2 py-1.5 text-slate-800">{r.requester || '—'}</td>
                <td className="px-2 py-1.5 text-slate-800">{r.designer || <span className="text-amber-700">未定</span>}</td>
                <td className="px-2 py-1.5 text-slate-800">
                  {r.media}
                  {r.usage && <div className="text-[11px] text-slate-500">{r.usage}</div>}
                </td>
                <td className="px-2 py-1.5 text-slate-700">{r.products || r.mainProducts || '—'}</td>
                <td className="max-w-[320px] px-2 py-1.5 text-slate-700">
                  <div className="line-clamp-2">{r.content || '—'}</div>
                  {r.event && <div className="text-[11px] text-slate-500">{r.event}{r.period ? `（${r.period}）` : ''}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 直近の完了 */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <div className="px-3 py-2">
          <h2 className="text-sm font-bold text-slate-800">直近の完了（{summary.done}件中 最新{recentDone.length}件）</h2>
        </div>
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left">NO.</th>
              <th className="px-2 py-2 text-left">依頼日</th>
              <th className="px-2 py-2 text-left">依頼者</th>
              <th className="px-2 py-2 text-left">作成者</th>
              <th className="px-2 py-2 text-left">媒体／用途</th>
              <th className="px-2 py-2 text-left">保存先</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recentDone.map((r) => (
              <tr key={`${r.no}-${r.rowNo}`}>
                <td className="px-2 py-1.5 tabular-nums text-slate-700">{r.no}</td>
                <td className="px-2 py-1.5 tabular-nums text-slate-700">{md(r.requestedAt)}</td>
                <td className="px-2 py-1.5 text-slate-800">{r.requester || '—'}</td>
                <td className="px-2 py-1.5 text-slate-800">{r.designer || '—'}</td>
                <td className="px-2 py-1.5 text-slate-800">
                  {r.media}
                  {r.usage && <span className="text-[11px] text-slate-500">／{r.usage}</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-600">{r.saved || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        判定: 納期は「本日希望」＝依頼日、「明日中」＝依頼日の翌日、日付はそのまま。解釈できない納期（「完成から1週間」など）は「日付不明」として超過判定しません。納期超過は3日以上で🔴、それ未満は🟡としてアラートセンターにも出ます。
      </p>
    </div>
  );
}
