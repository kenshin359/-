// 目標・予実管理（STANDARD）: 月間目標（メイン／ストレッチ）と、イベント日加重の日別目標 vs 日別実績（KPI報告）。
// 集計は src/lib/metrics/daily-targets.ts と kpi-kintone.computeMonthlyOverview のみ（画面で独自計算しない）。
// 出典: docs/business.md §6（通常1.0／マラソン1.7／スーパーSALE・スマイルセール2.0／最終日1.2〜1.3、メイン1.1億）。
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions, canWrite } from '@/lib/auth';
import { formatMetric, formatYen, jstDateKey } from '@/lib/metrics/format';
import { compareDailyTargets } from '@/lib/metrics/daily-targets';
import { achievementRate, computeMonthlyOverview } from '@/lib/pro/kpi-kintone';
import { eventsCalendarAvailable, getKpiRows, getMonthTargets, getTargetMonths, getWeights } from '@/lib/targets-data';
import { TargetsForm, WeightsTable } from './ui';

export const dynamic = 'force-dynamic';

function Card({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'bad' | 'dark' }) {
  const cls = tone === 'dark' ? 'bg-slate-900 text-white' : 'bg-white';
  const valueCls = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : tone === 'dark' ? 'text-white' : 'text-slate-900';
  return (
    <div className={`rounded-xl p-4 shadow-sm ${cls}`}>
      <p className={`text-xs ${tone === 'dark' ? 'text-slate-300' : 'text-slate-500'}`}>{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${valueCls}`}>{value}</p>
      {sub && <p className={`text-[11px] ${tone === 'dark' ? 'text-slate-300' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  );
}

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const writer = canWrite(session.user.role);

  const today = jstDateKey(new Date());
  const thisMonth = today.slice(0, 7);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : thisMonth;

  const [months, targets, weights, kpi, calendarAvailable] = await Promise.all([
    getTargetMonths(thisMonth),
    getMonthTargets(month),
    getWeights(month),
    getKpiRows(month),
    eventsCalendarAvailable(month),
  ]);

  const compare = compareDailyTargets(month, targets.main, weights.weights, kpi.rows);
  const overview = kpi.result.status === 'ok' ? computeMonthlyOverview(month, kpi.rows, kpi.prevRows, targets) : null;
  const stretchRate = compare.latestDate ? achievementRate(compare.actualToDate, targets.stretch) : { kind: 'na' as const, reason: 'データなし' };
  const fmtDate = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  const gapTone = compare.gapToDate.kind === 'value' ? (compare.gapToDate.value >= 0 ? 'good' : 'bad') : 'default';
  const gapValue =
    compare.gapToDate.kind === 'value' ? `${compare.gapToDate.value >= 0 ? '+' : '−'}${formatYen(Math.abs(compare.gapToDate.value))}` : compare.gapToDate.reason;
  const latestLabel = compare.latestDate ? `${Number(compare.latestDate.slice(5, 7))}/${Number(compare.latestDate.slice(8, 10))}` : '—';

  const targetStatus = targets.isDefault
    ? `仮置き（既定値 1.1億／1.2億・docs/business.md §6）。${writer ? '下で保存すると本値になります。' : '編集者以上が保存できます。'}`
    : `保存済み${targets.updatedBy ? `（${targets.updatedBy}` : ''}${targets.updatedAt ? ` ${fmtDate(targets.updatedAt)}` : ''}${targets.updatedBy ? '）' : ''}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">目標・予実管理 — 月間目標とイベント日加重の日別目標</h1>
          <p className="text-xs text-slate-500">
            日別目標 = 月間目標 × その日の重み ÷ 月内の重み合計（docs/business.md §6）。実績は Kintone 毎朝KPI報告(30)
            {kpi.result.status === 'ok' ? (kpi.result.source === 'cache' ? `（日次キャッシュ${kpi.result.cachedAt ? `・最終取込 ${fmtDate(new Date(kpi.result.cachedAt))}` : ''}）` : '（直接読み取り）') : ''}。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {months.map((m) => (
            <Link
              key={m}
              href={`/targets?month=${m}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${m === month ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'}`}
            >
              {m}
            </Link>
          ))}
        </div>
      </div>

      {/* ① 月間目標 */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">{month} の月間目標</h2>
            <p className="mt-1 text-xs text-slate-500">{targetStatus}</p>
            {(targets.seed.main != null || targets.seed.stretch != null) && (
              <p className="mt-1 text-[11px] text-amber-700">
                注: DB にデモシード由来の値（{targets.seed.main != null ? `メイン ${formatYen(targets.seed.main)}` : ''}
                {targets.seed.main != null && targets.seed.stretch != null ? '／' : ''}
                {targets.seed.stretch != null ? `ストレッチ ${formatYen(targets.seed.stretch)}` : ''}・更新者なし）がありますが、集計には使っていません。保存すると上書きされます。
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <div className="text-right">
              <p className="text-[11px] text-slate-500">メイン</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{formatYen(targets.main)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-500">ストレッチ</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{formatYen(targets.stretch)}</p>
            </div>
          </div>
        </div>
        {writer && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <TargetsForm month={month} main={targets.main} stretch={targets.stretch} />
          </div>
        )}
      </div>

      {/* ② 予実サマリー */}
      {kpi.result.status !== 'ok' ? (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-700">{month} の実績データがありません（未接続または未取込）。日別目標のみ表示しています。</p>
          <p className="mt-1 text-xs text-slate-500">{kpi.result.reason}</p>
        </div>
      ) : compare.dataDays === 0 ? (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-700">{month} のKPI報告はまだ取り込まれていません（日別目標のみ表示）。</p>
          <p className="mt-1 text-xs text-slate-500">毎朝11:20の「ダッシュボード取込」で入ります。推測値は表示しません。</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label={`累計実績（1〜${latestLabel}・${compare.dataDays}日分）`} value={formatYen(compare.actualToDate)} sub={`加重目標の累計 ${formatYen(compare.targetToDate)}`} tone="dark" />
          <Card label="累計の目標乖離（対 加重目標）" value={gapValue} sub={`達成率 ${formatMetric(compare.achievementToDate, '%', 1)}`} tone={gapTone} />
          <Card
            label="月間達成率（メイン／ストレッチ）"
            value={formatMetric(compare.achievementOfMonth, '%', 1)}
            sub={`ストレッチ ${formatMetric(stretchRate, '%', 1)}／残り ${overview?.remainingDays ?? '—'}日`}
          />
          <Card
            label={`必要日販（残り${overview?.remainingDays ?? '—'}日）`}
            value={overview ? formatMetric(overview.requiredDailyMain, '円') : '—'}
            sub={overview ? `ストレッチ ${formatMetric(overview.requiredDailyStretch, '円')}／直近${overview.avg7Days}日平均 ${formatMetric(overview.avg7, '円')}` : undefined}
          />
          <div className="col-span-2 rounded-xl bg-white p-4 shadow-sm md:col-span-4">
            <p className="text-xs text-slate-500">日次判定の内訳（売上 ÷ 日別目標: ≥100% 好調／≥70% まずまず／未満 要改善）</p>
            <p className="mt-1 text-sm tabular-nums text-slate-800">
              <span className="font-semibold text-emerald-700">好調 {compare.days.ok}日</span>
              <span className="mx-2 text-slate-300">／</span>
              <span className="font-semibold text-amber-700">まずまず {compare.days.warn}日</span>
              <span className="mx-2 text-slate-300">／</span>
              <span className="font-semibold text-red-600">要改善 {compare.days.danger}日</span>
              <span className="ml-3 text-xs text-slate-500">
                重み合計 {compare.weightTotal.toFixed(1)}（イベント日 {compare.eventDays}日／{compare.daysInMonth}日）
              </span>
            </p>
          </div>
        </div>
      )}

      {/* ③ 日別目標 vs 実績（重み編集） */}
      <WeightsTable month={month} rows={compare.rows} canWrite={writer} calendarAvailable={calendarAvailable} weightsSaved={weights.exists} today={today} />
      <p className="text-[11px] text-slate-500">
        重みの出どころ: {weights.source === 'setting' ? 'この画面で保存した値' : weights.source === 'calendar' ? '同梱イベントカレンダー（events-' + month + '.json・朝礼と同じ）' : '未設定のため全日1.0'}。保存先は Setting「{weights.key}」。PRO 経営ダッシュボードの本日判定も同じ値を使います。
        目標の保存先: Target（metric=sales／sales_stretch, scope=all）。日別目標の合計は月間目標にちょうど一致するよう円単位で配分しています。
      </p>
    </div>
  );
}
