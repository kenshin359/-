'use client';

// ⌘K / Ctrl+K のコマンドパレット。画面移動と横断検索（社員・タスク・資料・部署）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, Building2, CheckSquare, FileText, User, Layers } from 'lucide-react';
import { PRO_NAV } from './pro-nav';
import type { UiMode } from '@/lib/ui-mode';

type Hit = { kind: 'task' | 'document' | 'user' | 'team' | 'page'; id: string; title: string; subtitle?: string; href: string; badge?: string };

const STANDARD_PAGES: Hit[] = [
  { kind: 'page', id: 'p-home', title: 'ダッシュボード', href: '/' },
  { kind: 'page', id: 'p-tasks', title: 'タスク管理', href: '/tasks' },
  { kind: 'page', id: 'p-docs', title: '資料庫', href: '/documents' },
  { kind: 'page', id: 'p-targets', title: '目標・予実管理', href: '/targets' },
  { kind: 'page', id: 'p-int', title: 'データ連携設定', href: '/integrations' },
  { kind: 'page', id: 'p-users', title: 'ユーザー管理', href: '/masters/users' },
];

const KIND_ICON = { task: CheckSquare, document: FileText, user: User, team: Building2, page: Layers } as const;
const KIND_LABEL = { task: 'タスク', document: '資料', user: '社員', team: '部署', page: '画面' } as const;

export default function CommandPalette({ mode, staffOnly }: { mode: UiMode; staffOnly: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setRemote([]);
      setCursor(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  // 入力後 200ms で横断検索
  useEffect(() => {
    if (!open || q.trim().length < 1) {
      setRemote([]);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/pro/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        const j = (await r.json()) as { hits?: Hit[] };
        setRemote(j.hits ?? []);
      } catch {
        /* 中断・失敗は無視（画面移動候補は残る） */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q, open]);

  const pages: Hit[] = useMemo(() => {
    const pro = PRO_NAV.filter((i) => !staffOnly || i.staff).map<Hit>((i) => ({ kind: 'page', id: i.href, title: i.label, subtitle: 'PRO', href: i.href }));
    const all = mode === 'pro' ? [...pro, ...STANDARD_PAGES] : [...STANDARD_PAGES, ...pro];
    const kw = q.trim().normalize('NFKC').toLowerCase();
    return kw ? all.filter((p) => `${p.title} ${p.subtitle ?? ''}`.normalize('NFKC').toLowerCase().includes(kw)) : all.slice(0, 8);
  }, [q, mode, staffOnly]);

  const results = useMemo(() => [...pages, ...remote], [pages, remote]);
  useEffect(() => setCursor(0), [results.length]);

  const go = (h: Hit) => {
    setOpen(false);
    if (h.kind === 'document') window.open(h.href, '_blank', 'noopener');
    else router.push(h.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="検索（⌘K）"
        className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-500 hover:bg-white hover:text-slate-800"
      >
        <Search size={14} aria-hidden />
        <span className="hidden md:inline">検索</span>
        <kbd className="hidden rounded border border-slate-300 bg-white px-1 py-px font-sans text-[10px] text-slate-500 md:inline">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="コマンドパレット"
            className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl shadow-slate-900/30"
            style={{ animation: 'rise-in 160ms cubic-bezier(0.16,1,0.3,1) both' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-3">
              <Search size={16} aria-hidden className="text-slate-400" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, results.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  } else if (e.key === 'Enter' && results[cursor]) {
                    e.preventDefault();
                    go(results[cursor]);
                  }
                }}
                placeholder="画面・社員・タスク・資料・部署を検索…"
                aria-label="検索語"
                className="h-12 w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
              />
              {loading && <span className="text-[11px] text-slate-400">検索中…</span>}
            </div>
            <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
              {results.length === 0 && <li className="px-4 py-6 text-center text-xs text-slate-500">該当なし。別の言葉で試してください</li>}
              {results.map((h, i) => {
                const Icon = KIND_ICON[h.kind];
                return (
                  <li key={`${h.kind}-${h.id}`} role="option" aria-selected={i === cursor}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(h)}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === cursor ? 'bg-blue-50' : ''}`}
                    >
                      <Icon size={15} aria-hidden className="shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-900">{h.title}</span>
                        {h.subtitle && <span className="block truncate text-[11px] text-slate-500">{h.subtitle}</span>}
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{h.badge ?? KIND_LABEL[h.kind]}</span>
                      {i === cursor && <CornerDownLeft size={13} aria-hidden className="text-slate-400" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-1.5 text-[10px] text-slate-500">
              <span>↑↓ 移動 ・ Enter 開く ・ Esc 閉じる</span>
              <span>{mode === 'pro' ? 'PRO' : 'STANDARD'}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
