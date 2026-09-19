// 目標・予実管理（STANDARD）: イベント加重の日別目標と実績の対比。
// 配分・判定は src/lib/metrics/daily-target.ts のみ（朝礼 newsDaily.py と同じ式・同じしきい値）。
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getTargetMonth, getTargetMonths, type TargetDayRow } from '@/lib/target-data';
import { TARGET_JUDGEMENT_JA, type TargetJudgement } from '@/lib/metrics/daily-target';
import { formatMetric, jstDateKey } from '@/lib/metrics/format';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

const BADGE: Record<TargetJudgement, string> = {
  good: 'bg-emerald-100 text-emerald-800',
  fair: 'bg-amber-100 text-amber-800',
  poor: 'bg-red-100 text-red-800',
  na: 'bg-slate-100 text-slate-400',
};

function Badge({ j }: { j: TargetJudgement }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[j]}`}>{TARGET_JUDGEMENT_JA[j]}</span>;
}

function Diff({ v }: { v: number | null }) {
  if (v == null) return <span className="text-slate-300">−</span>;
  const cls = v >= 0 ? 'text-emerald-700' : 'text-red-600';
  return (
    <span className={`tabular-nums ${cls}`}>
      {v >= 0 ? '+' : '−'}
      {Math.abs(Math.round(v)).toLocaleString('ja-JP')}
    </span>
  );
}

function Card({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: TargetJudgement }) {
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

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const today = jstDateKey(new Date());
  const thisMonth = today.slice(0, 7);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : thisMonth;
  const [data, months] = await Promise.all([getTargetMonth(month), getTargetMonths(thisMonth)]);
  const { calendar, rows } = data;

  const todayRow: TargetDayRow | undefined = rows.find((r) => r.date === today);
  const latestRow = data.latestDate ? rows.find((r) => r.date === data.latestDate) : undefined;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800">目標・予実管理 — 日別目標（イベント加重）</h1>
            <p className="mt-1 text-xs text-slate-500">
              日次目標 ＝ 月間目標 × その日の重み ÷ 月内の重みの合計。重みはイベントカレンダー（通常1.0／楽天マラソン1.7／スーパーSALE・Amazonスマイルセール2.0／最終日1.2〜1.3）。
              判定は朝礼と同じ 達成率100%以上で「好調」・70%以上で「まずまず」・未満で「要改善」。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-slate-500">対象月</span>
            {months.map((m) => (
              <Link
                key={m}
                href={`/targets?month=${m}`}
                className={`rounded-md px-2 py-1 ${m === month ? 'bg-blue-900 text-white' : 'border border-slate-300 hover:bg-slate-50'}`}
              >
                {m}
              </Link>
            ))}
          </div>
        </div>

        {!calendar ? (
          <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            {month} のイベントカレンダーが未設定です。`daily-report-system/config/chorei/events-{month}.json` を用意し、
            `sh scripts/sync-events.sh` で取り込むと日別目標が出ます。数字は推測で作りません。
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card
                label="月間目標（メイン）"
                value={yen(calendar.targets.main)}
                sub={data.dbTarget.main != null ? '目標・予実管理の登録値' : 'イベントカレンダーの値'}
              />
              <Card label="月間目標（ストレッチ）" value={yen(calendar.targets.stretch)} />
              <Card
                label="累計実績"
                value={yen(data.monthToDate)}
                sub={`${data.actualDays}日ぶん取込${data.latestDate ? `（最終 ${data.latestDate}）` : ''}`}
              />
              <Card label="達成率（対 月間目標）" value={formatMetric(data.achievementRate, '%', 1)} />
              <Card
                label="経過日までの累計目標"
                value={data.latestDate ? yen(data.targetToDate) : '−'}
                sub="イベント加重の積み上げ"
              />
              <Card
                label="累計の過不足"
                value={data.latestDate ? `${data.monthToDate - data.targetToDate >= 0 ? '+' : '−'}${Math.abs(data.monthToDate - data.targetToDate).toLocaleString('ja-JP')}円` : '−'}
                sub="累計実績 − 累計目標"
              />
              <Card
                label="ペース"
                value={data.paceToDate.kind === 'value' ? `${data.paceToDate.value.toFixed(2)}倍` : data.paceToDate.reason}
                sub="1.00で計画どおり"
              />
              <Card
                label="必要日販（残り）"
                value={formatMetric(data.requiredDaily, '円', 0)}
                sub={`残り ${data.remainingDays}日`}
              />
            </div>

            {(todayRow || latestRow) && (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                {(() => {
                  const r = todayRow?.actual != null ? todayRow : latestRow;
                  if (!r) return null;
                  const isToday = r.date === today;
                  const target = r.reportedTarget ?? r.main;
                  return (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-slate-700">
                        {isToday ? '本日' : '最新日'} {r.date}
                        {r.label && <span className="ml-1 text-xs text-blue-700">{r.label}</span>}
                      </span>
                      <span className="tabular-nums text-slate-800">
                        実績 {r.actual == null ? '未取込' : yen(r.actual)} / 目標 {yen(target)}
                      </span>
                      <span className="tabular-nums text-slate-600">達成率 {formatMetric(r.rate, '%', 0)}</span>
                      <Badge j={r.judgement} />
                      <span className="text-xs text-slate-400">
                        目標の出どころ: {r.reportedTarget != null ? 'KPI報告の入力値' : 'イベントカレンダーの加重配分'}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            <p className="mt-2 text-[11px] text-slate-400">
              実績の取得元: {data.source === 'kintone' ? 'Kintone 毎朝KPI報告(30) 直接読み取り' : data.source === 'cache' ? '取込済みの日次データ（KpiDaily）' : '未取得'}
              {data.unavailableReason && <span className="ml-1 text-amber-700">（{data.unavailableReason}）</span>}
              ／ 重みの合計 {data.totalWeight.toFixed(1)}（{data.daysInMonth}日）
              {calendar.note && <span className="ml-1">／ {calendar.note}</span>}
            </p>
          </>
        )}
      </div>

      {calendar && (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">日別</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-2">日付</th>
                  <th className="py-2 pr-2">イベント</th>
                  <th className="py-2 pr-2 text-right">重み</th>
                  <th className="py-2 pr-2 text-right">日次目標</th>
                  <th className="py-2 pr-2 text-right">実績</th>
                  <th className="py-2 pr-2 text-right">乖離</th>
                  <th className="py-2 pr-2 text-right">達成率</th>
                  <th className="py-2 pr-2">判定</th>
                  <th className="py-2 pr-2 text-right">累計目標</th>
                  <th className="py-2 pr-2 text-right">累計実績</th>
                  <th className="py-2 text-right">累計乖離</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dow = new Date(`${r.date}T00:00:00Z`).getUTCDay();
                  const future = r.date > today && r.actual == null;
                  const isToday = r.date === today;
                  return (
                    <tr
                      key={r.date}
                      className={`border-b border-slate-100 ${isToday ? 'bg-blue-50/60' : ''} ${future ? 'text-slate-300' : ''}`}
                    >
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {Number(r.date.slice(5, 7))}/{r.day}
                        <span className={`ml-1 text-[11px] ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-slate-400'}`}>
                          {WEEK[dow]}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-blue-700">{r.label}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{r.weight.toFixed(1)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {yen(r.reportedTarget ?? r.main)}
                        {r.reportedTarget != null && r.reportedTarget !== r.main && (
                          <span className="ml-1 text-[10px] text-slate-400">報告値</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium tabular-nums">{r.actual == null ? '' : yen(r.actual)}</td>
                      <td className="py-1.5 pr-2 text-right"><Diff v={r.diff} /></td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{r.actual == null ? '' : formatMetric(r.rate, '%', 0)}</td>
                      <td className="py-1.5 pr-2">{r.actual == null ? '' : <Badge j={r.judgement} />}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{yen(r.cumulativeMain)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">
                        {r.cumulativeActual == null ? '' : yen(r.cumulativeActual)}
                      </td>
                      <td className="py-1.5 text-right"><Diff v={r.cumulativeDiff} /></td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-2 pr-2">月計</td>
                  <td className="py-2 pr-2"></td>
                  <td className="py-2 pr-2 text-right tabular-nums">{data.totalWeight.toFixed(1)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{yen(calendar.targets.main)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{yen(data.monthToDate)}</td>
                  <td className="py-2 pr-2 text-right"><Diff v={data.latestDate ? data.monthToDate - data.targetToDate : null} /></td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMetric(data.achievementRate, '%', 1)}</td>
                  <td className="py-2 pr-2"></td>
                  <td className="py-2 pr-2"></td>
                  <td className="py-2 pr-2"></td>
                  <td className="py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            ※ 日次目標は「KPI報告に日別目標が入っていればその値」、無ければイベントカレンダーの加重配分。
            月間目標を変えるときは `events-YYYY-MM.json` の `targets.main` を直し、`sh scripts/sync-events.sh` で取り込む。
            未来日と未取込の日は空欄のまま（0で埋めない）。
          </p>
        </div>
      )}
    </div>
  );
}
