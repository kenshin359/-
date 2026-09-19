'use client';

// 提案1件の状態切替（editor以上）。サーバーアクション側で再検証するので、ここは導線だけ。
import { useState, useTransition } from 'react';
import { PROPOSAL_STATUS_JA, PROPOSAL_STATUSES, type ProposalStatus } from '@/lib/metrics/proposals';
import { setProposalStatusAction, type ActionResult } from './actions';

const ACTIVE: Record<ProposalStatus, string> = {
  open: 'bg-slate-800 text-white',
  adopted: 'bg-emerald-600 text-white',
  held: 'bg-amber-500 text-white',
  rejected: 'bg-red-600 text-white',
};

export function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    open: 'bg-slate-100 text-slate-700',
    adopted: 'bg-emerald-100 text-emerald-800',
    held: 'bg-amber-100 text-amber-800',
    rejected: 'bg-red-100 text-red-800',
  };
  const ja = (PROPOSAL_STATUS_JA as Record<string, string>)[status] ?? status;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls[status] ?? 'bg-slate-100 text-slate-500'}`}>{ja}</span>;
}

export default function ProposalStatus({ id, status, statusNote, canWrite }: { id: string; status: string; statusNote: string | null; canWrite: boolean }) {
  const [note, setNote] = useState(statusNote ?? '');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (!canWrite) {
    return (
      <div className="text-[11px] text-slate-500">
        <StatusBadge status={status} />
        {statusNote && <p className="mt-1">{statusNote}</p>}
        <p className="mt-1 text-slate-400">状態の変更は編集者以上</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {PROPOSAL_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => start(async () => setResult(await setProposalStatusAction(id, s, note)))}
            className={`rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50 ${s === status ? ACTIVE[s] : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            {PROPOSAL_STATUS_JA[s]}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="判断メモ（任意・状態ボタンで保存）"
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400"
      />
      {result && <p className={`text-[11px] ${result.ok ? 'text-emerald-700' : 'text-red-700'}`}>{result.message}</p>}
    </div>
  );
}
