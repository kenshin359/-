'use client';

// 目標・予実管理のクライアント部品: 月間目標フォーム／日別の重み編集つき予実表。書込は actions.ts（サーバーで権限検証）。
import { useActionState } from 'react';
import DailyJudgeBadge from '@/components/DailyJudgeBadge';
import { formatMetric, formatYen } from '@/lib/metrics/format';
import type { DailyCompareRow } from '@/lib/metrics/daily-targets';
import { loadEventsCalendarAction, saveMonthTargetsAction, saveWeightsAction, type ActionResult } from './actions';

const input = 'rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums focus:border-blue-500 focus:outline-none';

function Message({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return <p className={`text-xs ${r.ok ? 'text-emerald-700' : 'text-red-600'}`}>{r.message}</p>;
}

export function TargetsForm({ month, main, stretch }: { month: string; main: number; stretch: number }) {
  const [result, action, pending] = useActionState(saveMonthTargetsAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="month" value={month} />
      <label className="text-[11px] text-slate-500">
        メイン目標（円）
        <input name="main" defaultValue={main} inputMode="numeric" className={`${input} block w-40 text-right`} />
      </label>
      <label className="text-[11px] text-slate-500">
        ストレッチ目標（円）
        <input name="stretch" defaultValue={stretch} inputMode="numeric" className={`${input} block w-40 text-right`} />
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? '保存中…' : '月間目標を保存'}
      </button>
      <Message r={result} />
    </form>
  );
}

function gapText(v: number | null): string {
  if (v == null) return '';
  return `${v >= 0 ? '+' : '−'}${formatYen(Math.abs(v))}`;
}

function gapClass(v: number | null): string {
  if (v == null) return 'text-slate-300';
  return v >= 0 ? 'text-emerald-700' : 'text-red-600';
}

export interface WeightsTableProps {
  month: string;
  rows: DailyCompareRow[];
  canWrite: boolean;
  /** 同梱イベントカレンダーに <month> があるか（無ければ読み込みボタンを出さず手入力に案内） */
  calendarAvailable: boolean;
  /** 重みが Setting に保存済みか */
  weightsSaved: boolean;
  /** YYYY-MM-DD（JST）。これより後の日は薄く表示 */
  today: string;
}

/** 日別の予実表。編集者以上は同じ表の中で重み・イベント名を編集して保存できる */
export function WeightsTable({ month, rows, canWrite, calendarAvailable, weightsSaved, today }: WeightsTableProps) {
  const [saveResult, saveAction, saving] = useActionState(saveWeightsAction, null);
  const [loadResult, loadAction, loading] = useActionState(loadEventsCalendarAction, null);
  const m = Number(month.slice(5));

  const table = (
    <table className="w-full min-w-[880px] text-sm">
      <thead className="bg-slate-50 text-xs text-slate-600">
        <tr>
          <th className="px-3 py-2 text-left">日付</th>
          <th className="px-2 py-2 text-left">イベント</th>
          <th className="px-2 py-2 text-right">重み</th>
          <th className="px-2 py-2 text-right">日別目標</th>
          <th className="px-2 py-2 text-right">実績</th>
          <th className="px-2 py-2 text-right">乖離</th>
          <th className="px-2 py-2 text-right">達成率</th>
          <th className="px-2 py-2 text-left">判定</th>
          <th className="px-2 py-2 text-right">累計目標</th>
          <th className="px-2 py-2 text-right">累計乖離</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => {
          const future = r.date > today && r.actual == null;
          return (
            <tr key={r.date} className={`${future ? 'text-slate-400' : 'text-slate-800'} ${r.weight !== 1 ? 'bg-amber-50/60' : ''}`}>
              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                {m}/{r.day}
              </td>
              <td className="px-2 py-1.5">
                {canWrite ? (
                  <input name={`l_${r.day}`} defaultValue={r.label} maxLength={60} placeholder="通常日" className={`${input} w-52 text-left`} />
                ) : (
                  <span className={r.label ? '' : 'text-slate-300'}>{r.label || '−'}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {canWrite ? (
                  <input name={`w_${r.day}`} defaultValue={r.weight === 1 && !r.label ? '' : String(r.weight)} inputMode="decimal" placeholder="1.0" className={`${input} w-16 text-right`} />
                ) : (
                  r.weight.toFixed(1)
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.target > 0 ? formatYen(r.target) : <span className="text-slate-300">−</span>}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{r.actual == null ? <span className="text-slate-300">−</span> : formatYen(r.actual)}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums ${gapClass(r.gap)}`}>{r.gap == null ? '−' : gapText(r.gap)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.actual == null ? <span className="text-slate-300">−</span> : formatMetric(r.achievement, '%', 0)}</td>
              <td className="px-2 py-1.5">{r.actual == null ? <span className="text-slate-300">−</span> : <DailyJudgeBadge j={r.judgement} />}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.cumTarget > 0 ? formatYen(r.cumTarget) : '−'}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums ${gapClass(r.cumGap)}`}>{r.cumGap == null ? '−' : gapText(r.cumGap)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  if (!canWrite) {
    return (
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        {table}
        <p className="px-3 py-2 text-[11px] text-slate-500">重み・イベント名の編集は編集者以上が行えます。</p>
      </div>
    );
  }

  return (
    <form action={saveAction} className="rounded-xl bg-white shadow-sm">
      <input type="hidden" name="month" value={month} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs text-slate-500">
          重みは空欄＝1.0（通常日）。楽天マラソン 1.7／楽天スーパーSALE・Amazonスマイルセール 2.0／イベント最終日 1.2〜1.3（docs/business.md §6）。
          {weightsSaved ? '' : ' 現在は未保存のため全日 1.0 で等分しています。'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {calendarAvailable ? (
            <button
              type="submit"
              formAction={loadAction}
              disabled={loading}
              onClick={(e) => {
                if (!confirm(`events-${month}.json の重みで ${month} の重みを上書きします。よろしいですか？`)) e.preventDefault();
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? '読み込み中…' : 'イベントカレンダーから読み込む'}
            </button>
          ) : (
            <span className="text-[11px] text-slate-400">events-{month}.json が同梱カレンダーに無いため、重みは下の表で手入力してください（月初に sync-events.sh で取り込み）</span>
          )}
          <button type="submit" disabled={saving} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50">
            {saving ? '保存中…' : '重みを保存'}
          </button>
        </div>
      </div>
      <div className="px-3 pb-2">
        <Message r={loadResult ?? saveResult} />
      </div>
      <div className="overflow-x-auto">{table}</div>
    </form>
  );
}
