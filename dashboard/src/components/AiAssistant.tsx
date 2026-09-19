'use client';

// AIアシスタント（PRO ⑦）: 右下の丸ボタン → パネル。会社の状態（ダッシュボードの取込値）を根拠に Claude が答える。
// 未接続（ANTHROPIC_API_KEY 未設定）のときは理由と設定方法を出す。会話履歴はこのパネルの state だけ（保存しない）。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';
import { btn, inputCls, Notice } from './ui';

type Status = { kind: 'unknown' } | { kind: 'ok'; model: string } | { kind: 'unavailable'; reason: string };
type Turn = { role: 'user' | 'assistant'; text: string; error?: boolean };

type AskResponse =
  | { status: 'ok'; answer: string; model: string; truncated?: boolean }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; reason: string }
  | { error: string };

const MAX_CHARS = 1000;
const SETUP_HINT = 'Vercel に ANTHROPIC_API_KEY を設定すると使えます（任意で ANTHROPIC_MODEL も）。';

export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'unknown' });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 開いたときに接続状態を確認（未接続なら先に理由を出す）
  useEffect(() => {
    if (!open || status.kind !== 'unknown') return;
    let cancelled = false;
    fetch('/api/ai/ask', { method: 'GET' })
      .then((r) => r.json() as Promise<{ status?: string; model?: string; reason?: string }>)
      .then((j) => {
        if (cancelled) return;
        if (j.status === 'ok') setStatus({ kind: 'ok', model: j.model ?? '' });
        else if (j.status === 'unavailable') setStatus({ kind: 'unavailable', reason: j.reason ?? '未接続' });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, status.kind]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, pending]);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || pending) return;
    setQuestion('');
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setPending(true);
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const j = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as AskResponse;
      if ('error' in j) {
        setTurns((t) => [...t, { role: 'assistant', text: res.status === 401 ? 'ログインが切れています。再読み込みしてください' : j.error, error: true }]);
      } else if (j.status === 'ok') {
        setStatus({ kind: 'ok', model: j.model });
        setTurns((t) => [...t, { role: 'assistant', text: j.truncated ? `${j.answer}\n\n（回答が長すぎて途中で切れました）` : j.answer }]);
      } else if (j.status === 'unavailable') {
        setStatus({ kind: 'unavailable', reason: j.reason });
        setTurns((t) => [...t, { role: 'assistant', text: `${j.reason}。${SETUP_HINT}`, error: true }]);
      } else {
        setTurns((t) => [...t, { role: 'assistant', text: `回答できませんでした: ${j.reason}`, error: true }]);
      }
    } catch (err) {
      setTurns((t) => [...t, { role: 'assistant', text: `通信エラー: ${err instanceof Error ? err.message : String(err)}`, error: true }]);
    } finally {
      setPending(false);
    }
  };

  const unavailable = status.kind === 'unavailable';

  return (
    <>
      {/* 右下の丸ボタン。スマホ幅では PRO の MobileNav（下部56px前後）と重ならないよう上に寄せる */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="AIアシスタントを開く"
          title="AIアシスタント"
          className="fixed right-4 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-900 text-white shadow-lg shadow-blue-950/30 transition-colors hover:bg-blue-800 focus-visible:outline-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:right-6"
        >
          <Sparkles size={20} aria-hidden />
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="AIアシスタント"
          className="fixed inset-x-0 z-40 flex flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl shadow-slate-900/30 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[75vh] rounded-t-2xl sm:inset-x-auto sm:right-4 sm:w-[380px] sm:rounded-2xl lg:bottom-6 lg:right-6 lg:max-h-[600px]"
          style={{ animation: 'rise-in 180ms cubic-bezier(0.16,1,0.3,1) both' }}
        >
          <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles size={16} aria-hidden className="shrink-0 text-blue-900" />
              <h2 className="truncate text-sm font-bold text-slate-800">AIアシスタント</h2>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${unavailable ? 'bg-slate-100 text-slate-600' : status.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {unavailable ? '未接続' : status.kind === 'ok' ? '接続中' : '確認中'}
              </span>
            </div>
            <button type="button" onClick={() => setOpen(false)} className={btn.ghost} aria-label="閉じる">
              <X size={16} aria-hidden />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {unavailable && (
              <Notice tone="warn">
                <span className="block font-semibold">{status.reason}</span>
                <span className="block">{SETUP_HINT}</span>
              </Notice>
            )}
            {turns.length === 0 && !unavailable && (
              <p className="text-xs leading-relaxed text-slate-500">
                会社の状態（今月の売上・目標ペース・広告費率・未解決アラート・タスク・KPI・直近の報告・商品別売上）を根拠に答えます。
                無い数字は「未取得」と答え、推測はしません。回答には出典（画面名）が付きます。
                <br />
                例: 「今月の目標ペースは？」「期限超過のタスクは何件？」「一番売れている商品は？」
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    t.role === 'user' ? 'bg-blue-900 text-white' : t.error ? 'border border-amber-200 bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  {t.text}
                </div>
              </div>
            ))}
            {pending && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500" role="status">
                <Loader2 size={14} aria-hidden className="animate-spin" />
                回答を作成中…
              </div>
            )}
          </div>

          <form onSubmit={ask} className="border-t border-slate-200 px-3 py-2.5">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                maxLength={MAX_CHARS}
                disabled={pending || unavailable}
                placeholder={unavailable ? '未接続のため質問できません' : '質問を入力（Enterで送信・Shift+Enterで改行）'}
                aria-label="質問"
                className={`${inputCls} resize-none`}
              />
              <button type="submit" disabled={pending || unavailable || !question.trim()} className={`${btn.primary} h-9 shrink-0 px-3`} aria-label="送信">
                <Send size={15} aria-hidden />
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
              <span>{status.kind === 'ok' && status.model ? `モデル: ${status.model}` : '会話はこの画面内だけ（保存しません）'}</span>
              <span>
                {question.length}/{MAX_CHARS}
              </span>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
