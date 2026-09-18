'use client';

// 資料庫2.0（PRO）。検索が主役: 上に大きな検索欄、下に絞り込みチップ、結果は密な一覧。
// 登録・編集・削除・一括タグは editor 以上（サーバーでも検証）。機密種別は管理職以上にしか届かない。
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileType2,
  Folder,
  Link2,
  Pencil,
  Plus,
  Presentation,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { btn, EmptyState, Field, inputCls, Notice, SlideOver } from '@/components/ui';
import { DOC_CATEGORIES, DOC_DEPARTMENTS, DOC_KIND_LABEL, type DocKind } from '@/lib/documents';
import {
  DOC_TYPES,
  isConfidentialDocType,
  parseTags,
  UPDATED_WITHIN,
  type DocType,
  type DriveSearchResult,
  type LibraryApiResponse,
  type LibraryDoc,
  type LibrarySearchResult,
  type LibrarySort,
  type UpdatedWithin,
} from '@/lib/pro/library';
import { bulkTagAction, createLibraryDocAction, deleteLibraryDocAction, updateLibraryDocAction, type ActionResult } from './actions';

const KIND_ICON: Record<DocKind, { icon: LucideIcon; cls: string }> = {
  folder: { icon: Folder, cls: 'bg-amber-50 text-amber-700' },
  doc: { icon: FileText, cls: 'bg-blue-50 text-blue-700' },
  sheet: { icon: FileSpreadsheet, cls: 'bg-emerald-50 text-emerald-700' },
  slide: { icon: Presentation, cls: 'bg-orange-50 text-orange-700' },
  form: { icon: ClipboardList, cls: 'bg-violet-50 text-violet-700' },
  pdf: { icon: FileType2, cls: 'bg-red-50 text-red-700' },
  link: { icon: Link2, cls: 'bg-slate-100 text-slate-600' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
}

interface Filters {
  docType: DocType | '';
  category: string;
  department: string;
  tag: string;
  owner: string;
  updatedWithin: UpdatedWithin | '';
  sort: LibrarySort;
}
const EMPTY_FILTERS: Filters = { docType: '', category: '', department: '', tag: '', owner: '', updatedWithin: '', sort: 'updated' };

function buildParams(q: string, f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (f.docType) p.set('docType', f.docType);
  if (f.category) p.set('category', f.category);
  if (f.department) p.set('department', f.department);
  if (f.tag) p.set('tag', f.tag);
  if (f.owner) p.set('owner', f.owner);
  if (f.updatedWithin) p.set('updatedWithin', String(f.updatedWithin));
  if (f.sort !== 'updated') p.set('sort', f.sort);
  return p;
}

export default function LibraryView({
  initial,
  initialQuery,
  initialTag,
  canEdit,
  canConfidential,
  driveOn,
}: {
  initial: LibrarySearchResult;
  initialQuery: string;
  initialTag: string;
  canEdit: boolean;
  canConfidential: boolean;
  driveOn: boolean;
}) {
  const [q, setQ] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, tag: initialTag });
  const [result, setResult] = useState<LibrarySearchResult>(initial);
  const [drive, setDrive] = useState<DriveSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LibraryDoc | null>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const reqId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  const runSearch = useCallback(
    async (query: string, f: Filters) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const p = buildParams(query, f);
        if (driveOn) p.set('drive', '1');
        const res = await fetch(`/api/pro/library?${p.toString()}`, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `検索に失敗しました（HTTP ${res.status}）`);
        }
        const j = (await res.json()) as LibraryApiResponse;
        if (id !== reqId.current) return;
        const { drive: dr, ...rest } = j;
        setResult(rest);
        setDrive(driveOn ? dr : null);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (id !== reqId.current) return;
        setError(e instanceof Error ? e.message : '検索に失敗しました');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [driveOn],
  );

  // 検索語は300msのデバウンス。フィルタは即時。初回はサーバー描画済みなので飛ばす（Drive有効時は初回検索語があれば取りに行く）
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (driveOn && initialQuery.trim()) void runSearch(initialQuery, filters);
      return;
    }
    const t = setTimeout(() => void runSearch(q, filters), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    const next = { ...filters, [key]: filters[key] === value && key !== 'sort' ? '' : value } as Filters;
    setFilters(next);
    void runSearch(q, next);
  };
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    void runSearch(q, EMPTY_FILTERS);
  };
  const refetch = () => void runSearch(q, filters);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runSearch(q, filters);
    }
  };

  const activeFilterCount = [filters.docType, filters.category, filters.department, filters.tag, filters.owner, filters.updatedWithin].filter(Boolean).length;
  const facet = (list: { value: string; count: number }[], v: string) => list.find((x) => x.value === v)?.count ?? 0;
  const typeChips = DOC_TYPES.filter((t) => canConfidential || !isConfidentialDocType(t.code));
  const categoryChips = useMemo(() => {
    const extra = result.facets.category.map((c) => c.value).filter((c) => !(DOC_CATEGORIES as readonly string[]).includes(c));
    return [...DOC_CATEGORIES, ...extra];
  }, [result.facets.category]);
  const departmentChips = result.facets.department;
  const allTags = useMemo(() => result.tags.map((t) => t.tag), [result.tags]);

  const items = result.items;
  const allSelectedOnPage = items.length > 0 && items.every((d) => selected.has(d.id));
  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allSelectedOnPage ? new Set() : new Set(items.map((d) => d.id)));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">資料庫2.0</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            タグ・種別・カテゴリ・部署・登録者・更新日で横断検索。ファイル本体はドライブに置いたまま、ここにはリンクとタグを登録します。
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setAdding(true)} className={btn.primary}>
            <Plus size={15} aria-hidden /> 資料
          </button>
        )}
      </header>

      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      {/* 検索 */}
      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <label className="relative block">
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="資料名・メモ・タグ・部署・登録者で検索（空白区切りで絞り込み）"
            aria-label="資料を検索"
            autoFocus
            className={`${inputCls} py-2.5 pl-10 pr-20 text-base`}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400" aria-live="polite">
            {loading ? '検索中…' : 'Enter で検索'}
          </span>
        </label>

        <div className="mt-2 flex items-center justify-between gap-2 sm:hidden">
          <button type="button" onClick={() => setShowFilters((v) => !v)} className={btn.secondary} aria-expanded={showFilters}>
            <SlidersHorizontal size={14} aria-hidden /> 絞り込み
            {activeFilterCount > 0 && <span className="rounded-full bg-blue-900 px-1.5 text-[10px] font-semibold text-white">{activeFilterCount}</span>}
            <ChevronDown size={14} aria-hidden className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className={`${btn.ghost} text-xs`}>
              クリア
            </button>
          )}
        </div>

        <div className={`${showFilters ? 'block' : 'hidden'} mt-3 space-y-2.5 sm:block`}>
          <FilterRow label="種別">
            {typeChips.map((t) => (
              <Chip key={t.code} on={filters.docType === t.code} count={facet(result.facets.docType, t.code)} onClick={() => setFilter('docType', t.code)}>
                {t.label}
              </Chip>
            ))}
          </FilterRow>
          <FilterRow label="カテゴリ">
            {categoryChips.map((c) => (
              <Chip key={c} on={filters.category === c} count={facet(result.facets.category, c)} onClick={() => setFilter('category', c)}>
                {c}
              </Chip>
            ))}
          </FilterRow>
          {departmentChips.length > 0 && (
            <FilterRow label="部署">
              {departmentChips.map((d) => (
                <Chip key={d.value} on={filters.department === d.value} count={d.count} onClick={() => setFilter('department', d.value)}>
                  {d.value}
                </Chip>
              ))}
            </FilterRow>
          )}
          <FilterRow label="更新">
            {UPDATED_WITHIN.map((n) => (
              <Chip key={n} on={filters.updatedWithin === n} onClick={() => setFilter('updatedWithin', n)}>
                {n}日以内
              </Chip>
            ))}
          </FilterRow>
          <FilterRow label="タグ">
            {result.tags.length === 0 ? (
              <span className="text-[11px] text-slate-500">まだタグがありません。登録・編集でタグを付けると、ここに並びます。</span>
            ) : (
              result.tags.map((t) => (
                <Chip key={t.tag} on={filters.tag.toLowerCase() === t.tag.toLowerCase()} count={t.count} onClick={() => setFilter('tag', t.tag)}>
                  <Tag size={11} aria-hidden /> {t.tag}
                </Chip>
              ))
            )}
          </FilterRow>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              登録者
              <select value={filters.owner} onChange={(e) => setFilter('owner', e.target.value)} className={`${inputCls} w-auto py-1 text-xs`}>
                <option value="">すべて</option>
                {result.facets.owner.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value}（{o.count}）
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              並び順
              <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value as LibrarySort)} className={`${inputCls} w-auto py-1 text-xs`}>
                <option value="updated">更新が新しい順</option>
                <option value="title">資料名順</option>
              </select>
            </label>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className={`${btn.ghost} ml-auto hidden text-xs sm:inline-flex`}>
                <X size={12} aria-hidden /> 絞り込みをクリア
              </button>
            )}
          </div>
        </div>
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      {/* 結果 */}
      <section className="rounded-xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-600 sm:px-4">
          {canEdit && items.length > 0 && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={allSelectedOnPage} onChange={toggleAll} aria-label="表示中の資料をすべて選択" className="h-3.5 w-3.5 accent-blue-900" />
              <span className="sr-only">すべて選択</span>
            </label>
          )}
          <span className="tabular">
            <strong className="text-slate-900">{result.total}</strong> 件
            {result.total !== result.corpus && <span className="text-slate-500">（全 {result.corpus} 件）</span>}
            {result.total > items.length && <span className="text-slate-500"> ・ 先頭 {items.length} 件を表示</span>}
          </span>
          {canEdit && selected.size > 0 && <BulkTagBar ids={[...selected]} suggestions={allTags} onDone={(r) => { setFlash(r); if (r.ok) { setSelected(new Set()); refetch(); } }} onClear={() => setSelected(new Set())} />}
        </div>

        {items.length === 0 ? (
          <div className="p-3 sm:p-4">
            <EmptyState
              title={result.corpus === 0 ? 'まだ資料が登録されていません' : '条件に合う資料はありません'}
              body={
                <span className="block space-y-1 text-left">
                  <span className="block">使い方は3ステップ:</span>
                  <span className="block">1. 検索語を入れる（例: 「研修 CS」のように空白区切りで絞り込み）</span>
                  <span className="block">2. タグ・種別・部署で絞る</span>
                  <span className="block">3. まだ無ければ「＋資料」で登録する（タグを付けておくと次から見つかる）</span>
                </span>
              }
              action={
                canEdit ? (
                  <button type="button" onClick={() => setAdding(true)} className={btn.primary}>
                    <Plus size={15} aria-hidden /> 資料を登録
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((d) => (
              <DocRow
                key={d.id}
                doc={d}
                canEdit={canEdit}
                selected={selected.has(d.id)}
                onSelect={() => toggleSelect(d.id)}
                onTag={(t) => setFilter('tag', t)}
                onEdit={() => setEditing(d)}
                onDeleted={(r) => {
                  setFlash(r);
                  if (r.ok) refetch();
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Drive */}
      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <h2 className="text-sm font-bold text-slate-800">Googleドライブ横断検索</h2>
        {!driveOn ? (
          <div className="mt-2">
            <Notice tone="info">
              Drive横断検索は未接続です。サービスアカウント（GOOGLE_DRIVE_SA_JSON）と対象フォルダ（GOOGLE_DRIVE_FOLDER_IDS）を設定すると、登録していないファイルもファイル名で探せます。
            </Notice>
          </div>
        ) : (
          <DriveResults q={q} drive={drive} loading={loading} />
        )}
      </section>

      <SlideOver open={adding} title="資料を登録" onClose={() => setAdding(false)}>
        {adding && (
          <LibraryDocForm
            doc={null}
            canConfidential={canConfidential}
            suggestions={allTags}
            onDone={(r) => {
              setFlash(r);
              if (r.ok) {
                setAdding(false);
                refetch();
              }
            }}
          />
        )}
      </SlideOver>
      <SlideOver open={editing !== null} title="資料を編集" onClose={() => setEditing(null)}>
        {editing && (
          <LibraryDocForm
            key={editing.id}
            doc={editing}
            canConfidential={canConfidential}
            suggestions={allTags}
            onDone={(r) => {
              setFlash(r);
              if (r.ok) {
                setEditing(null);
                refetch();
              }
            }}
          />
        )}
      </SlideOver>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="w-14 shrink-0 text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, count, onClick, children }: { on: boolean; count?: number; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        on ? 'border-blue-900 bg-blue-900 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
      }`}
    >
      {children}
      {count !== undefined && <span className={`tabular text-[11px] ${on ? 'text-blue-100' : 'text-slate-500'}`}>{count}</span>}
    </button>
  );
}

function DocRow({
  doc: d,
  canEdit,
  selected,
  onSelect,
  onTag,
  onEdit,
  onDeleted,
}: {
  doc: LibraryDoc;
  canEdit: boolean;
  selected: boolean;
  onSelect: () => void;
  onTag: (tag: string) => void;
  onEdit: () => void;
  onDeleted: (r: ActionResult) => void;
}) {
  const k = KIND_ICON[d.kind];
  const Icon = k.icon;
  return (
    <li className={`flex flex-wrap items-start gap-3 px-3 py-2.5 transition-colors sm:flex-nowrap sm:px-4 ${selected ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}>
      {canEdit && (
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`${d.title} を選択`} className="mt-2 h-3.5 w-3.5 shrink-0 accent-blue-900" />
      )}
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${k.cls}`} title={DOC_KIND_LABEL[d.kind]}>
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <a href={d.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-semibold text-slate-900 hover:text-blue-900">
          {d.title}
        </a>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
          <span className={`rounded px-1.5 py-px font-medium ${isConfidentialDocType(d.docType) ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{d.docTypeLabel}</span>
          <span>{d.category}</span>
          {d.department && <span>・ {d.department}</span>}
          <span>・ {d.ownerName || '登録者不明'}</span>
          <span className="tabular">・ {fmtDate(d.updatedAt)}</span>
        </p>
        {d.tags.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1">
            {d.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTag(t)}
                className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-px text-[11px] text-slate-700 hover:border-blue-900 hover:text-blue-900"
                aria-label={`タグ ${t} で絞り込む`}
              >
                <Tag size={10} aria-hidden /> {t}
              </button>
            ))}
          </p>
        )}
        {d.note && <p className="mt-1 line-clamp-1 text-xs text-slate-600">{d.note}</p>}
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
        <a href={d.url} target="_blank" rel="noopener noreferrer" className={`${btn.secondary} px-2 py-1 text-xs`} aria-label={`${d.title} を新しいタブで開く`}>
          <ExternalLink size={12} aria-hidden /> 開く
        </a>
        {canEdit && (
          <>
            <button type="button" onClick={onEdit} className={`${btn.ghost} px-1.5 py-1 text-xs`} aria-label={`${d.title} を編集`}>
              <Pencil size={12} aria-hidden /> 編集
            </button>
            <DeleteButton doc={d} onDone={onDeleted} />
          </>
        )}
      </div>
    </li>
  );
}

function DeleteButton({ doc, onDone }: { doc: LibraryDoc; onDone: (r: ActionResult) => void }) {
  const [result, formAction, pending] = useActionState(deleteLibraryDocAction, null);
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
      <button type="submit" disabled={pending} className={`${btn.ghost} px-1.5 py-1 text-xs text-red-700 hover:bg-red-50`} aria-label={`${doc.title} を削除`}>
        <Trash2 size={12} aria-hidden /> 削除
      </button>
    </form>
  );
}

function BulkTagBar({ ids, suggestions, onDone, onClear }: { ids: string[]; suggestions: string[]; onDone: (r: ActionResult) => void; onClear: () => void }) {
  const [tag, setTag] = useState('');
  const [pending, startTransition] = useTransition();
  const run = (mode: 'add' | 'remove') => {
    const fd = new FormData();
    for (const id of ids) fd.append('ids', id);
    fd.set('tag', tag);
    fd.set('mode', mode);
    startTransition(async () => {
      const r = await bulkTagAction(null, fd);
      onDone(r);
      if (r.ok) setTag('');
    });
  };
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1.5 sm:ml-auto sm:w-auto" role="group" aria-label="選択した資料への一括操作">
      <span className="text-xs font-medium text-blue-900">{ids.length}件選択</span>
      <input
        list="library-tag-suggestions"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (tag.trim()) run('add');
          }
        }}
        placeholder="タグ"
        aria-label="一括で付け外しするタグ"
        className={`${inputCls} w-32 py-1 text-xs`}
      />
      <datalist id="library-tag-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button type="button" disabled={pending || !tag.trim()} onClick={() => run('add')} className={`${btn.primary} px-2 py-1 text-xs`}>
        <Plus size={12} aria-hidden /> 追加
      </button>
      <button type="button" disabled={pending || !tag.trim()} onClick={() => run('remove')} className={`${btn.secondary} px-2 py-1 text-xs`}>
        <X size={12} aria-hidden /> 外す
      </button>
      <button type="button" onClick={onClear} className={`${btn.ghost} px-1.5 py-1 text-xs`}>
        選択解除
      </button>
    </div>
  );
}

function DriveResults({ q, drive, loading }: { q: string; drive: DriveSearchResult | null; loading: boolean }) {
  if (!q.trim()) return <p className="mt-2 text-xs text-slate-500">検索語を入れると、指定フォルダ内のファイル名も一緒に検索します。</p>;
  if (!drive) return <p className="mt-2 text-xs text-slate-500">{loading ? 'Driveを検索中…' : 'Enter で検索します。'}</p>;
  if (drive.status === 'unconfigured') return <div className="mt-2"><Notice tone="info">Drive横断検索は未接続です。</Notice></div>;
  if (drive.status === 'error') return <div className="mt-2"><Notice tone="error">Drive検索に失敗しました: {drive.message}</Notice></div>;
  if (drive.files.length === 0) return <p className="mt-2 text-xs text-slate-500">Driveに一致するファイルはありません{drive.folderCount > 0 ? `（対象フォルダ ${drive.folderCount} 件の直下）` : ''}。</p>;
  return (
    <ul className="mt-2 divide-y divide-slate-100">
      {drive.files.map((f) => {
        const k = KIND_ICON[f.kind];
        const Icon = k.icon;
        return (
          <li key={f.id} className="flex items-center gap-3 py-2">
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${k.cls}`}>
              <Icon size={14} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-slate-900">{f.name}</span>
              <span className="block text-[11px] text-slate-500">
                {DOC_KIND_LABEL[f.kind]} ・ <span className="tabular">{fmtDate(f.modifiedTime)}</span>
              </span>
            </span>
            <a href={f.url} target="_blank" rel="noopener noreferrer" className={`${btn.secondary} px-2 py-1 text-xs`} aria-label={`${f.name} を新しいタブで開く`}>
              <ExternalLink size={12} aria-hidden /> 開く
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function LibraryDocForm({
  doc,
  canConfidential,
  suggestions,
  onDone,
}: {
  doc: LibraryDoc | null;
  canConfidential: boolean;
  suggestions: string[];
  onDone: (r: ActionResult) => void;
}) {
  const [result, formAction, pending] = useActionState(doc ? updateLibraryDocAction : createLibraryDocAction, null);
  const [tags, setTags] = useState<string[]>(doc?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const commitTag = () => {
    const next = parseTags([...tags, ...tagInput.split(/[,、]/)]);
    setTags(next);
    setTagInput('');
  };
  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '、') {
      e.preventDefault();
      commitTag();
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };
  const types = DOC_TYPES.filter((t) => canConfidential || !isConfidentialDocType(t.code));

  return (
    <form action={formAction} className="space-y-3">
      {doc && <input type="hidden" name="id" value={doc.id} />}
      <input type="hidden" name="tags" value={tags.join(',')} />
      <Field label="資料名" required>
        <input name="title" required maxLength={120} defaultValue={doc?.title ?? ''} className={inputCls} placeholder="例: 営業研修資料" />
      </Field>
      <Field label="GoogleドライブのURL" required hint="ドライブで「リンクを取得」→ 社内の閲覧権限を付けたURLを貼る（https://）">
        <input name="url" type="url" required defaultValue={doc?.url ?? ''} className={inputCls} placeholder="https://drive.google.com/drive/folders/…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="種別" required hint={canConfidential ? '人事資料・契約書は管理職以上にだけ表示されます' : undefined}>
          <select name="docType" required defaultValue={doc?.docType ?? 'other'} className={inputCls}>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="カテゴリ" required>
          <select name="category" required defaultValue={doc?.category ?? ''} className={inputCls}>
            <option value="">選択</option>
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="部署・チーム">
        <select name="department" defaultValue={doc?.department ?? ''} className={inputCls}>
          <option value="">指定なし</option>
          {DOC_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          {doc?.department && !DOC_DEPARTMENTS.includes(doc.department) && <option value={doc.department}>{doc.department}</option>}
        </select>
      </Field>
      <Field label="タグ" hint="Enter またはカンマで追加。検索で見つけやすい言葉（商品名・用途・年度など）を付ける">
        <div className={`${inputCls} flex min-h-[38px] flex-wrap items-center gap-1 py-1`}>
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-2 py-px text-xs text-blue-900">
              <Tag size={10} aria-hidden /> {t}
              <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} className="ml-0.5 rounded-full p-0.5 hover:bg-blue-100" aria-label={`タグ ${t} を外す`}>
                <X size={10} aria-hidden />
              </button>
            </span>
          ))}
          <input
            list="library-form-tag-suggestions"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={onTagKey}
            onBlur={() => tagInput.trim() && commitTag()}
            placeholder={tags.length === 0 ? '例: マニュアル 2026 スーツケース' : ''}
            aria-label="タグを追加"
            className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
          />
          <datalist id="library-form-tag-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </Field>
      <Field label="メモ" hint="何の資料か、誰向けかを一言（検索対象になります）">
        <textarea name="note" rows={3} maxLength={500} defaultValue={doc?.note ?? ''} className={inputCls} />
      </Field>
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? '保存中…' : doc ? <><Check size={14} aria-hidden /> 保存</> : <><Plus size={14} aria-hidden /> 登録</>}
        </button>
      </div>
    </form>
  );
}
