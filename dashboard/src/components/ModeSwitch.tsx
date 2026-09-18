'use client';

// STANDARD / PRO の切替。Cookie を書いてから遷移する（既存ユーザーは STANDARD のまま）。
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setUiModeAction } from '@/app/actions/ui-mode';
import type { UiMode } from '@/lib/ui-mode';

export default function ModeSwitch({ mode }: { mode: UiMode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (m: UiMode) => {
    if (m === mode) return;
    start(async () => {
      await setUiModeAction(m);
      router.push(m === 'pro' ? '/pro' : '/');
      router.refresh();
    });
  };
  return (
    <div
      role="radiogroup"
      aria-label="表示モード"
      className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold tracking-wide"
    >
      {(['standard', 'pro'] as const).map((m) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            onClick={() => go(m)}
            title={m === 'pro' ? '経営・管理職向けの高機能表示' : '現在のシンプルな表示'}
            className={`rounded px-2.5 py-1 transition-colors ${
              on ? (m === 'pro' ? 'bg-blue-900 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm') : 'text-slate-500 hover:text-slate-800'
            } disabled:opacity-60`}
          >
            {m === 'pro' ? 'PRO' : 'STANDARD'}
          </button>
        );
      })}
    </div>
  );
}
