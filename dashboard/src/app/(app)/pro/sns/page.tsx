// PRO: SNS投稿カレンダー（「SNS投稿スケジュール」シートの可視化）。
// 数字は src/lib/metrics/sns-schedule.ts の集計のみ。シートが正（ダッシュボードは読むだけ）。
import type { Metadata } from 'next';
import { requireActor } from '@/lib/rbac';
import { getSnsData } from '@/lib/sns-data';
import { POST_STATUS_JA, type PostStatus, type SnsPost } from '@/lib/metrics/sns-schedule';
import { shiftDate } from '@/lib/metrics/sheet-cells';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'SNS投稿カレンダー' };

const STATUS_CLS: Record<PostStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-blue-100 text-blue-800',
  posted: 'bg-emerald-100 text-emerald-800',
};
const WD = ['日', '月', '火', '水', '木', '金', '土'];

function md(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}
function wd(d: string): string {
  const [y, m, dd] = d.split('-').map(Number);
  return WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
}

function PostCard({ p }: { p: SnsPost }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-1.5 text-[11px] leading-tight">
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold text-slate-800">{p.media || '媒体?'}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_CLS[p.status]}`}>{POST_STATUS_JA[p.status]}</span>
      </div>
      <div className="mt-0.5 text-slate-600">
        {p.time && <span className="mr-1 tabular-nums">{p.time}</span>}
        {p.owner && <span>{p.owner}</span>}
      </div>
      {p.content && <div className="mt-0.5 line-clamp-2 text-slate-700">{p.content}</div>}
    </div>
  );
}

export default async function SnsPage() {
  await requireActor();
  const data = await getSnsData();
  const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

  if (data.status === 'unavailable') {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-bold text-slate-800">SNS投稿カレンダー</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">未接続</p>
          <p className="mt-1">{data.reason}</p>
          <p className="mt-2 text-xs">
            シートを開き、右上「共有」→「一般的なアクセス」を「リンクを知っている全員（閲覧者）」にすると、5分以内にここへ表示されます。
          </p>
          {data.sheetUrl && (
            <a href={data.sheetUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">
              シートを開く
            </a>
          )}
        </div>
      </div>
    );
  }

  const { today, posts, summary, sheetUrl, fetchedAt } = data;
  const days = Array.from({ length: 14 }, (_, i) => shiftDate(today, i));
  const byDay = new Map<string, SnsPost[]>();
  for (const p of posts) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]);
  const upcoming = posts.filter((p) => p.date >= today).slice(0, 40);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">SNS投稿カレンダー</h1>
          <p className="text-xs text-slate-500">
            出典: SNS投稿スケジュール（Googleスプレッドシート）。最終取得 {fmt(fetchedAt)}。投稿の追加・状態の変更はシートで行います（5分以内に反映）。
          </p>
        </div>
        <a href={sheetUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
          シートを開く ↗
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { l: '今日の投稿', v: summary.today.length, cls: 'text-slate-900' },
          { l: '未投稿（予定日超過）', v: summary.unposted.length, cls: summary.unposted.length > 0 ? 'text-red-700' : 'text-emerald-700' },
          { l: '7日以内の予定', v: summary.upcoming7.length, cls: 'text-slate-900' },
          { l: '承認待ち', v: summary.pending.length, cls: summary.pending.length > 0 ? 'text-amber-700' : 'text-slate-900' },
          { l: '今月 投稿済／予定', v: `${summary.monthPosted}／${summary.monthPlanned}`, cls: 'text-slate-900' },
        ].map((t) => (
          <div key={t.l} className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t.l}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${t.cls}`}>{t.v}</p>
          </div>
        ))}
      </div>
      {summary.gap3 && posts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">🟡 明日〜3日先に投稿予定がありません。シートに予定を追加してください。</div>
      )}
      {posts.length === 0 && (
        <div className="rounded-xl bg-white p-6 text-sm text-slate-600 shadow-sm">
          シートに投稿予定がまだありません。1行＝1投稿で「投稿予定日・媒体・アカウント・担当・内容・状態」を入力すると、ここにカレンダーとして出ます。
        </div>
      )}

      {/* 14日カレンダー */}
      <div className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-slate-800">今日から14日間</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const isToday = d === today;
            const w = wd(d);
            return (
              <div key={d} className={`min-h-[84px] rounded-lg border p-1.5 ${isToday ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
                <div className={`mb-1 text-xs font-semibold ${w === '日' ? 'text-red-600' : w === '土' ? 'text-blue-600' : 'text-slate-700'}`}>
                  {md(d)}（{w}）{isToday && <span className="ml-1 rounded bg-slate-900 px-1 text-[10px] text-white">今日</span>}
                </div>
                <div className="space-y-1">
                  {list.map((p) => (
                    <PostCard key={p.rowNo} p={p} />
                  ))}
                  {list.length === 0 && <div className="text-[11px] text-slate-300">予定なし</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 未投稿 */}
      {summary.unposted.length > 0 && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <div className="px-3 py-2">
            <h2 className="text-sm font-bold text-red-700">未投稿（予定日を過ぎて「投稿済」になっていない）</h2>
          </div>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-2 py-2 text-left">予定日</th>
                <th className="px-2 py-2 text-left">媒体／アカウント</th>
                <th className="px-2 py-2 text-left">担当</th>
                <th className="px-2 py-2 text-left">状態</th>
                <th className="px-2 py-2 text-left">内容</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.unposted.map((p) => (
                <tr key={p.rowNo} className="bg-red-50/60">
                  <td className="px-2 py-1.5 tabular-nums text-slate-700">{md(p.date)}（{wd(p.date)}）{p.time && ` ${p.time}`}</td>
                  <td className="px-2 py-1.5 text-slate-800">
                    {p.media}
                    {p.account && <span className="text-[11px] text-slate-500">／{p.account}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-800">{p.owner || <span className="text-amber-700">未定</span>}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[p.status]}`}>{POST_STATUS_JA[p.status]}</span>
                  </td>
                  <td className="max-w-[360px] px-2 py-1.5 text-slate-700">
                    <div className="line-clamp-2">{p.content || '—'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 今後の予定一覧 */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <div className="px-3 py-2">
          <h2 className="text-sm font-bold text-slate-800">今後の予定（{upcoming.length}件）</h2>
        </div>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left">予定日</th>
              <th className="px-2 py-2 text-left">媒体／アカウント</th>
              <th className="px-2 py-2 text-left">担当</th>
              <th className="px-2 py-2 text-left">状態</th>
              <th className="px-2 py-2 text-left">内容</th>
              <th className="px-2 py-2 text-left">素材</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {upcoming.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                  今後の予定はありません
                </td>
              </tr>
            )}
            {upcoming.map((p) => (
              <tr key={p.rowNo} className={p.date === today ? 'bg-slate-50' : ''}>
                <td className="px-2 py-1.5 tabular-nums text-slate-700">{md(p.date)}（{wd(p.date)}）{p.time && ` ${p.time}`}</td>
                <td className="px-2 py-1.5 text-slate-800">
                  {p.media}
                  {p.account && <span className="text-[11px] text-slate-500">／{p.account}</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-800">{p.owner || <span className="text-amber-700">未定</span>}</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[p.status]}`}>{POST_STATUS_JA[p.status]}</span>
                </td>
                <td className="max-w-[360px] px-2 py-1.5 text-slate-700">
                  <div className="line-clamp-2">{p.content || '—'}</div>
                </td>
                <td className="px-2 py-1.5 text-xs">
                  {p.assetLink ? (
                    <a href={p.assetLink} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                      素材
                    </a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 今月 媒体別 */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">今月の媒体別（投稿済／予定）</h2>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2 md:grid-cols-4">
          {summary.monthByMedia.length === 0 && <li className="text-slate-400">今月の予定なし</li>}
          {summary.monthByMedia.map((m) => (
            <li key={m.media} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1">
              <span className="text-slate-800">{m.media}</span>
              <span className="tabular-nums text-slate-800">
                {m.posted}／{m.planned}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-slate-500">判定: 予定日を過ぎて「投稿済」でない → 🔴未投稿（アラートセンターにも出ます）。明日〜3日先に予定が無い → 🟡。結果（いいね・再生）はシートに記入した値をそのまま表示します。</p>
    </div>
  );
}
