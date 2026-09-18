'use client';

import { useActionState, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  deleteDayAction,
  importPasteAction,
  saveDayAction,
  saveThresholdsAction,
  type ActionResult,
} from './actions';

const input =
  'w-full rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums focus:border-blue-500 focus:outline-none';

function Message({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return <p className={`text-xs ${r.ok ? 'text-emerald-600' : 'text-red-600'}`}>{r.message}</p>;
}

export interface DayFormValues {
  date: string;
  suitcaseSales: number | null;
  meta: number;
  amazonAds: number;
  rpp: number;
  google: number;
  other: number;
  unitsAmazon: number;
  unitsRakuten: number;
  unitsOwn: number;
  note: string;
  exists: boolean;
}

const FIELDS: { key: keyof DayFormValues; label: string }[] = [
  { key: 'suitcaseSales', label: 'スーツケース売上（税込）' },
  { key: 'meta', label: 'メタ' },
  { key: 'amazonAds', label: 'Amazon広告' },
  { key: 'rpp', label: 'RPP' },
  { key: 'google', label: 'Google' },
  { key: 'other', label: 'その他' },
  { key: 'unitsAmazon', label: 'Amazon個数' },
  { key: 'unitsRakuten', label: '楽天個数' },
  { key: 'unitsOwn', label: '自社個数' },
];

export function DayEditor({ v, canWrite }: { v: DayFormValues; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [saveResult, saveAction, saving] = useActionState(saveDayAction, null);
  const [delResult, delAction, deleting] = useActionState(deleteDayAction, null);
  if (!canWrite) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
      >
        {open ? '閉じる' : v.exists ? '編集' : '入力'}
      </button>
      {open && (
        <form action={saveAction} className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
          <input type="hidden" name="date" value={v.date} />
          {FIELDS.map((f) => (
            <label key={f.key} className="text-[11px] text-slate-500">
              {f.label}
              <input
                name={f.key}
                inputMode="numeric"
                defaultValue={v[f.key] == null ? '' : String(v[f.key])}
                className={input}
                placeholder={f.key === 'suitcaseSales' ? '未取得は空欄' : '0'}
              />
            </label>
          ))}
          <label className="col-span-2 text-[11px] text-slate-500 md:col-span-3">
            メモ
            <input name="note" defaultValue={v.note} maxLength={200} className={input + ' text-left'} placeholder="例: Amazon広告CSV未添付" />
          </label>
          <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-blue-900 px-3 py-1 text-xs text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            {v.exists && (
              <button
                type="submit"
                formAction={delAction}
                disabled={deleting}
                onClick={(e) => {
                  if (!confirm(`${v.date} の入力を削除します。よろしいですか？`)) e.preventDefault();
                }}
                className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                削除
              </button>
            )}
            <Message r={saveResult ?? delResult} />
          </div>
        </form>
      )}
    </div>
  );
}

export function ImportForm({ month }: { month: string }) {
  const [result, action, pending] = useActionState(importPasteAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="month" value={month} />
      <textarea
        name="text"
        required
        rows={6}
        className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
        placeholder={'合算CPA Excel「日次」シートを見出し行ごとコピーして貼り付け（日付 / スーツケース売上 / メタ / Amazon広告 / RPP / Google / その他 / Amazon個数 / 楽天個数 / 自社個数）\nまたは cpa_inputs.json の中身を貼り付け'}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-900 px-4 py-1.5 text-sm text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? '取込中…' : '取り込む（同じ日付は上書き）'}
        </button>
        <Message r={result} />
      </div>
    </form>
  );
}

export function ThresholdsForm({ aov, targetPct, limitPct }: { aov: number; targetPct: number; limitPct: number }) {
  const [result, action, pending] = useActionState(saveThresholdsAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-[11px] text-slate-500">
        想定客単価（税込）
        <input name="aov" defaultValue={aov} inputMode="numeric" className={input + ' w-28'} />
      </label>
      <label className="text-[11px] text-slate-500">
        目標 広告比率（%）
        <input name="targetRatio" defaultValue={targetPct} inputMode="decimal" className={input + ' w-20'} />
      </label>
      <label className="text-[11px] text-slate-500">
        許容 広告比率（%）
        <input name="limitRatio" defaultValue={limitPct} inputMode="decimal" className={input + ' w-20'} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? '保存中…' : '基準を保存'}
      </button>
      <Message r={result} />
    </form>
  );
}

export interface ChartPoint {
  day: string;
  cpa: number | null;
  moving7: number | null;
}

export function CpaChart({ data, target, limit }: { data: ChartPoint[]; target: number; limit: number }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
          <Tooltip formatter={(v) => (v == null ? '−' : `¥${Math.round(Number(v)).toLocaleString('ja-JP')}`)} />
          <ReferenceLine y={target} stroke="#16a34a" strokeDasharray="4 4" label={{ value: '目標', fontSize: 10, fill: '#16a34a', position: 'right' }} />
          <ReferenceLine y={limit} stroke="#dc2626" strokeDasharray="4 4" label={{ value: '許容', fontSize: 10, fill: '#dc2626', position: 'right' }} />
          <Line type="monotone" dataKey="cpa" name="合算CPA" stroke="#1e3a8a" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="moving7" name="7日移動" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
