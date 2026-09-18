'use client';

// 資料庫。Googleドライブの資料をカテゴリ・部署・種類で探せる一覧。登録・編集は editor 以上。
import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  Link2,
  FileType2,
  Presentation,
  ClipboardList,
  Pencil,
  Plus,
  Search,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { btn, EmptyState, inputCls, Notice, SlideOver } from '@/components/ui';
import { DOC_CATEGORIES, DOC_KIND_LABEL, type DocKind, type DocumentItem } from '@/lib/documents';
import { deleteDocumentAction, type ActionResult } from './actions';
import DocForm from './DocForm';

const KIND_ICON: Record<DocKind, { icon: LucideIcon; cls: string }> = {
  folder: { icon: Folder, cls: 'bg-amber-50 text-amber-700' },
  doc: { icon: FileText, cls: 'bg-blue-50 text-blue-700' },
  sheet: { icon: FileSpreadsheet, cls: 'bg-emerald-50 text-emerald-700' },
  slide: { icon: Presentation, cls: 'bg-orange-50 text-orange-700' },
  form: { icon: ClipboardList, cls: 'bg-violet-50 text-violet-700' },
  pdf: { icon: FileType2, cls: 'bg-red-50 text-red-700' },
  link: { icon: Link2, cls: 'bg-slate-100 text-slate-600' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function DocumentLibrary({
  docs,
  canEdit,
}: {
  docs: DocumentItem[];
  canEdit: boolean;
  currentUserId: string;
}) {
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<ActionResult | null>(null);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs) m.set(d.category, (m.get(d.category) ?? 0) + 1);
    return m;
  }, [docs]);

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return docs.filter((d) => {
      if (cat !== 'all' && d.category !== cat) return false;
      if (kw && !`${d.title} ${d.department} ${d.note} ${d.ownerName} ${DOC_KIND_LABEL[d.kind]}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [docs, cat, q]);

  const cats = ['all', ...DOC_CATEGORIES.filter((c) => counts.has(c)), ...[...counts.keys()].filter((c) => !(DOC_CATEGORIES as readonly string[]).includes(c))];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">資料庫</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Googleドライブの資料を、カテゴリと部署で探せる場所。ファイル本体はドライブに置いたまま、ここにはリンクだけを登録します。
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setAdding(true)} className={btn.primary}>
            <Plus size={15} aria-hidden /> 資料を登録
          </button>
        )}
      </header>

      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="カテゴリ">
            {cats.map((c) => {
              const on = cat === c;
              const n = c === 'all' ? docs.length : (counts.get(c) ?? 0);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCat(c)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on ? 'border-blue-900 bg-blue-900 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  {c === 'all' ? 'すべて' : c}
                  <span className={`tabular text-[11px] ${on ? 'text-blue-100' : 'text-slate-500'}`}>{n}</span>
                </button>
              );
            })}
          </div>
          <label className="relative ml-auto block w-full sm:w-72">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="資料名・部署・登録者で検索"
              aria-label="資料を検索"
              className={`${inputCls} pl-8`}
            />
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={docs.length === 0 ? 'まだ資料が登録されていません' : '条件に合う資料はありません'}
          body={
            docs.length === 0
              ? '就業規則・研修資料・マーケティングレポートなど、チームで使うドライブのフォルダやファイルを登録すると、ここから1クリックで開けます。'
              : '検索語を変えるか、カテゴリを「すべて」に戻してください。'
          }
          action={
            canEdit && docs.length === 0 ? (
              <button type="button" onClick={() => setAdding(true)} className={btn.primary}>
                <Plus size={15} aria-hidden /> 最初の資料を登録
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((d) => {
            const k = KIND_ICON[d.kind];
            const Icon = k.icon;
            return (
              <li key={d.id} className="rise-in group flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 gap-3 p-4"
                  aria-label={`${d.title} を新しいタブで開く`}
                >
                  <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${k.cls}`}>
                    <Icon size={20} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-blue-900">{d.title}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {d.category}
                      {d.department && ` ・ ${d.department}`}
                      {` ・ ${DOC_KIND_LABEL[d.kind]}`}
                    </span>
                    {d.note && <span className="mt-1 line-clamp-2 block text-xs leading-snug text-slate-600">{d.note}</span>}
                  </span>
                  <ExternalLink size={14} aria-hidden className="mt-0.5 shrink-0 text-slate-300 transition-colors group-hover:text-blue-900" />
                </a>
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                  <span className="truncate">
                    {d.ownerName || '登録者不明'} <span className="tabular">・ {fmtDate(d.updatedAt)}</span>
                    {d.host && <span className="hidden sm:inline"> ・ {d.host}</span>}
                  </span>
                  {canEdit && (
                    <span className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => setEditing(d)} className={`${btn.ghost} px-1.5 py-0.5 text-[11px]`} aria-label={`${d.title} を編集`}>
                        <Pencil size={12} aria-hidden /> 編集
                      </button>
                      <DeleteButton doc={d} onDone={setFlash} />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <SlideOver open={adding} title="資料を登録" onClose={() => setAdding(false)}>
        {adding && (
          <DocForm
            doc={null}
            onDone={(r) => {
              setFlash(r);
              if (r.ok) setAdding(false);
            }}
          />
        )}
      </SlideOver>
      <SlideOver open={editing !== null} title="資料を編集" onClose={() => setEditing(null)}>
        {editing && (
          <DocForm
            key={editing.id}
            doc={editing}
            onDone={(r) => {
              setFlash(r);
              if (r.ok) setEditing(null);
            }}
          />
        )}
      </SlideOver>
    </div>
  );
}

function DeleteButton({ doc, onDone }: { doc: DocumentItem; onDone: (r: ActionResult) => void }) {
  const [result, formAction, pending] = useActionState(deleteDocumentAction, null);
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`「${doc.title}」の登録を削除します。ドライブ上のファイルは消えません。よろしいですか？`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={doc.id} />
      <button type="submit" disabled={pending} className={`${btn.ghost} px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-50`} aria-label={`${doc.title} を削除`}>
        <Trash2 size={12} aria-hidden /> 削除
      </button>
    </form>
  );
}
