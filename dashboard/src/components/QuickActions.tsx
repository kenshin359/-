'use client';

// クイックアクション: どの画面からでも ＋タスク／＋資料／＋報告／＋メモ。画面移動なしで右パネルに入力。
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, CheckSquare, FileText, NotebookPen, StickyNote } from 'lucide-react';
import { btn, Field, inputCls, Notice, SlideOver } from './ui';
import TaskForm from '@/app/(app)/tasks/TaskForm';
import DocForm from '@/app/(app)/documents/DocForm';
import { TEAMS, MEMBERS } from '@/lib/tasks-constants';
import { createNoteAction, type ActionResult } from '@/app/actions/notes';

type Kind = 'task' | 'document' | 'report' | 'note';

const ITEMS: { kind: Kind; label: string; icon: typeof Plus; hint: string }[] = [
  { kind: 'task', label: 'タスク', icon: CheckSquare, hint: '期限と完了の定義が必須' },
  { kind: 'document', label: '資料', icon: FileText, hint: 'ドライブのURLを登録' },
  { kind: 'report', label: '報告', icon: NotebookPen, hint: '日報・週報・中間報告' },
  { kind: 'note', label: 'メモ', icon: StickyNote, hint: '1行だけ残す' },
];

export default function QuickActions() {
  const [menu, setMenu] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  const done = (r: ActionResult) => {
    setFlash(r);
    if (r.ok) {
      setKind(null);
      router.refresh();
    }
  };

  const title = { task: 'タスクを追加', document: '資料を登録', report: '報告を書く', note: 'メモを残す' } as const;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setMenu(!menu)}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label="追加"
        className={`${btn.primary} h-8 px-2.5`}
      >
        <Plus size={15} aria-hidden />
        <span className="hidden md:inline">追加</span>
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10">
          {ITEMS.map((it) => (
            <button
              key={it.kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                if (it.kind === 'report') router.push('/pro/reports?new=1');
                else setKind(it.kind);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50"
            >
              <it.icon size={15} aria-hidden className="text-slate-500" />
              <span>
                <span className="block text-sm text-slate-900">＋ {it.label}</span>
                <span className="block text-[11px] text-slate-500">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {flash && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>
        </div>
      )}
      <SlideOver open={kind !== null} title={kind ? title[kind] : ''} onClose={() => setKind(null)}>
        {kind === 'task' && <TaskForm options={{ teams: TEAMS, members: MEMBERS }} task={null} canEdit onDone={done} />}
        {kind === 'document' && <DocForm doc={null} onDone={done} />}
        {kind === 'note' && <NoteForm onDone={done} />}
      </SlideOver>
    </div>
  );
}

function NoteForm({ onDone }: { onDone: (r: ActionResult) => void }) {
  const [result, formAction, pending] = useActionState(createNoteAction, null);
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  return (
    <form action={formAction} className="space-y-3">
      <Field label="メモ" required hint="気づき・決めたこと・誰かに伝えること。あとで報告やタスクに整理できます">
        <textarea name="body" required rows={5} maxLength={2000} className={inputCls} placeholder="例: 楽天マラソン初日、Sサイズの在庫が薄い。笹本さんに納品前倒しを相談" />
      </Field>
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}
