'use client';

// 担当者別カンバン。毎朝「状態だけ更新」できる最短導線と、柳井ルール（期限・完了の定義・撤退基準）を
// フォームで強制する。編集は editor 以上（サーバーで再検証）。
import { useEffect, useMemo, useOptimistic, useState, useTransition, type ReactNode } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Database,
  Flag,
  Plus,
  RotateCcw,
  Search,
  Users,
} from 'lucide-react';
import { btn, inputCls, Notice, EmptyState, SlideOver } from '@/components/ui';
import type { BoardStats, TaskItem, TaskOptions } from '@/lib/tasks';
import type { TaskStatus } from '@/lib/tasks-constants';
import { PRIORITIES, STATUSES } from '@/lib/tasks-constants';
import TaskForm from './TaskForm';
import { setTaskStatusAction, type ActionResult } from './actions';

export type BoardFilter = 'all' | 'today' | 'overdue' | 'p1' | 'open';

interface Props {
  tasks: TaskItem[];
  options: TaskOptions;
  stats: BoardStats;
  source: 'kintone' | 'local';
  notice: string | null;
  appId: string;
  canEdit: boolean;
  currentUserName: string;
  initialFilter: BoardFilter;
  initialQuery?: string;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function fmtDue(due: string): string {
  const [y, m, d] = due.split('-').map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${w})`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const PRIORITY_CLS: Record<string, string> = {
  P1: 'bg-red-600 text-white',
  P2: 'bg-blue-900 text-white',
  P3: 'bg-slate-200 text-slate-700',
  P4: 'bg-slate-100 text-slate-500',
};

function DueChip({ due, today, done }: { due: string | null; today: string; done: boolean }) {
  if (!due) return <span className="text-[11px] text-slate-400">期限なし</span>;
  const diff = daysBetween(today, due);
  let cls = 'bg-slate-100 text-slate-600';
  let label = fmtDue(due);
  if (!done) {
    if (diff < 0) {
      cls = 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200';
      label = `${fmtDue(due)} ${-diff}日超過`;
    } else if (diff === 0) {
      cls = 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300';
      label = '今日まで';
    } else if (diff <= 3) {
      cls = 'bg-amber-50 text-amber-800';
      label = `${fmtDue(due)} あと${diff}日`;
    }
  }
  return (
    <span className={`tabular inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      <CalendarClock size={11} aria-hidden />
      {label}
    </span>
  );
}

function matchesUser(assignee: string, userName: string): boolean {
  if (!assignee || !userName) return false;
  const a = assignee.replace(/\s/g, '');
  const u = userName.replace(/\s/g, '');
  return u.startsWith(a) || a.startsWith(u);
}

type Load = { label: string; cls: string; reason: string };
function columnLoad(open: number, overdue: number): Load {
  if (overdue > 0) return { label: `期限超過 ${overdue}`, cls: 'bg-red-50 text-red-700 ring-red-200', reason: '期限を過ぎた未完了タスクがあります' };
  if (open >= 8) return { label: '多め', cls: 'bg-amber-50 text-amber-800 ring-amber-200', reason: '未完了が8件以上あります。P1から順に' };
  if (open <= 3) return { label: '余裕あり', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', reason: '未完了が3件以下です' };
  return { label: '通常', cls: 'bg-slate-100 text-slate-600 ring-slate-200', reason: '未完了が4〜7件です' };
}

export default function TaskBoard(props: Props) {
  const { options, stats, source, notice, appId, canEdit, currentUserName, initialFilter, initialQuery = '' } = props;
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [team, setTeam] = useState<string>('all');
  const [filter, setFilter] = useState<BoardFilter>(initialFilter);
  const [q, setQ] = useState(initialQuery);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [, startTransition] = useTransition();

  // 状態変更は即座に画面へ反映し、サーバー結果で確定する
  const [tasks, applyStatus] = useOptimistic(props.tasks, (state: TaskItem[], u: { id: string; status: TaskStatus }) =>
    state.map((t) => (t.id === u.id ? { ...t, status: u.status } : t)),
  );

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  const setStatus = (id: string, status: TaskStatus) => {
    startTransition(async () => {
      applyStatus({ id, status });
      const r = await setTaskStatusAction(id, status);
      setFlash(r);
    });
  };

  const visible = useMemo(() => {
    const today = stats.today;
    const kw = q.trim().toLowerCase();
    return tasks.filter((t) => {
      const done = t.status === '完了';
      if (tab === 'open' ? done : !done) return false;
      if (team !== 'all' && t.team !== team) return false;
      if (filter === 'today' && t.due !== today) return false;
      if (filter === 'overdue' && !(t.due && t.due < today)) return false;
      if (filter === 'p1' && t.priority !== 'P1') return false;
      if (kw && !`${t.title} ${t.doneDef} ${t.assignee} ${t.team} ${t.memo}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [tasks, tab, team, filter, q, stats.today]);

  // 列 = 担当者。並びは Kintone の選択肢順、自分を先頭に
  const columns = useMemo(() => {
    const by = new Map<string, TaskItem[]>();
    for (const t of visible) {
      const k = t.assignee || '未割当';
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(t);
    }
    const order = [...options.members, '未割当'];
    const names = [...by.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    const self = names.filter((n) => matchesUser(n, currentUserName));
    const rest = names.filter((n) => !matchesUser(n, currentUserName));
    const rank = (t: TaskItem) => (t.status === '完了' ? 9 : PRIORITIES.indexOf(t.priority as (typeof PRIORITIES)[number]));
    return [...self, ...rest].map((name) => {
      const list = by.get(name)!.slice().sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
      const allOfPerson = tasks.filter((t) => (t.assignee || '未割当') === name && t.status !== '完了');
      const overdue = allOfPerson.filter((t) => t.due && t.due < stats.today).length;
      return { name, list, isSelf: matchesUser(name, currentUserName), load: columnLoad(allOfPerson.length, overdue), teams: [...new Set(allOfPerson.map((t) => t.team).filter(Boolean))] };
    });
  }, [visible, tasks, options.members, currentUserName, stats.today]);

  const chips: { key: BoardFilter; label: string; n: number; tone: string }[] = [
    { key: 'overdue', label: '期限超過', n: stats.overdue, tone: stats.overdue ? 'text-red-700' : 'text-slate-600' },
    { key: 'today', label: '本日期限', n: stats.dueToday, tone: stats.dueToday ? 'text-amber-800' : 'text-slate-600' },
    { key: 'p1', label: 'P1 未完了', n: stats.p1Open, tone: 'text-slate-700' },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">タスク管理</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            担当者ごとに「今日やること」を並べる。期限と完了の定義（数字）のないタスクは登録できません。
          </p>
        </div>
        <SourceBadge source={source} appId={appId} />
      </header>

      {notice && <Notice tone={source === 'local' ? 'warn' : 'info'}>{notice}</Notice>}
      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="表示">
            <TabButton active={tab === 'open'} onClick={() => setTab('open')} icon={<Circle size={13} aria-hidden />}>
              進行中 <span className="tabular text-slate-500">{stats.open}</span>
            </TabButton>
            <TabButton active={tab === 'done'} onClick={() => setTab('done')} icon={<CheckCircle2 size={13} aria-hidden />}>
              完了済み
            </TabButton>
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <Users size={13} aria-hidden />
            <select value={team} onChange={(e) => setTeam(e.target.value)} className={`${inputCls.replace("w-full", "")} w-auto py-1`} aria-label="チームで絞り込む">
              <option value="all">すべてのチーム</option>
              {options.teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="朝礼の観点で絞り込む">
            {chips.map((c) => {
              const on = filter === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(on ? 'all' : c.key)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on ? 'border-blue-900 bg-blue-900 text-white' : `border-slate-200 bg-white hover:bg-slate-50 ${c.tone}`
                  }`}
                >
                  {c.key === 'overdue' && <AlertTriangle size={12} aria-hidden />}
                  {c.key === 'p1' && <Flag size={12} aria-hidden />}
                  {c.label}
                  <span className="tabular font-semibold">{c.n}</span>
                </button>
              );
            })}
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600" title="更新日が昨日で状態が完了のタスク">
              <Check size={12} aria-hidden />
              昨日完了 <span className="tabular font-semibold">{stats.doneYesterday}</span>
            </span>
          </div>
          <label className="relative ml-auto block w-full sm:w-64">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="タスク名・担当・完了の定義で検索"
              aria-label="タスクを検索"
              className={`${inputCls} pl-8`}
            />
          </label>
        </div>
      </div>

      {columns.length === 0 ? (
        <EmptyState
          title={tab === 'done' ? '完了したタスクはまだありません' : '条件に合うタスクはありません'}
          body={
            tab === 'done'
              ? '進行中タブでタスクの丸をクリックすると完了になります。'
              : '絞り込みを外すか、下の「タスクを追加」から期限と完了の定義を決めて登録してください。'
          }
          action={
            canEdit && tab === 'open' ? (
              <NewTaskButton options={options} defaultAssignee={options.members.find((m) => matchesUser(m, currentUserName)) ?? ''} onDone={setFlash} />
            ) : undefined
          }
        />
      ) : (
        <div className="scroll-x -mx-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
          <div className="flex min-h-[60vh] snap-x gap-3">
            {columns.map((col) => (
              <section
                key={col.name}
                aria-label={`${col.name} のタスク`}
                className={`flex w-[300px] shrink-0 snap-start flex-col rounded-xl border ${
                  col.isSelf ? 'border-blue-900/40 bg-blue-50/40' : 'border-slate-200 bg-white'
                } shadow-sm`}
              >
                <header className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2.5">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-bold text-slate-900">
                      {col.name}
                      {col.isSelf && <span className="ml-1 text-[11px] font-medium text-blue-900">（自分）</span>}
                    </h2>
                    <p className="truncate text-[11px] text-slate-500">{col.teams.join('・') || 'チーム未設定'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span title={col.load.reason} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${col.load.cls}`}>
                      {col.load.label}
                    </span>
                    <span className="tabular rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">{col.list.length}</span>
                  </div>
                </header>
                <ul className="flex-1 space-y-2 p-2">
                  {col.list.map((t) => (
                    <li key={t.id}>
                      <TaskCard task={t} today={stats.today} canEdit={canEdit} onOpen={() => setEditing(t)} onStatus={setStatus} />
                    </li>
                  ))}
                </ul>
                {canEdit && tab === 'open' && (
                  <div className="border-t border-slate-200/70 p-2">
                    <NewTaskButton options={options} defaultAssignee={col.name === '未割当' ? '' : col.name} defaultTeam={col.teams[0]} onDone={setFlash} />
                  </div>
                )}
              </section>
            ))}
            {canEdit && tab === 'open' && (
              <section className="flex w-[260px] shrink-0 snap-start flex-col justify-start rounded-xl border border-dashed border-slate-300 p-3">
                <p className="text-xs font-medium text-slate-600">まだタスクのない担当者へ</p>
                <p className="mb-2 text-[11px] text-slate-500">担当者を選んで最初のタスクを登録します</p>
                <NewTaskButton options={options} defaultAssignee="" onDone={setFlash} />
              </section>
            )}
          </div>
        </div>
      )}

      <SlideOver open={editing !== null} title="タスクを編集" onClose={() => setEditing(null)}>
        {editing && (
          <TaskForm
            key={editing.id}
            options={options}
            task={editing}
            canEdit={canEdit}
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

function SourceBadge({ source, appId }: { source: 'kintone' | 'local'; appId: string }) {
  const ok = source === 'kintone';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <Database size={12} aria-hidden />
      {ok ? `Kintone タスク管理(${appId}) と同期中` : '未接続: このDBに保存'}
    </span>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function TaskCard({
  task: t,
  today,
  canEdit,
  onOpen,
  onStatus,
}: {
  task: TaskItem;
  today: string;
  canEdit: boolean;
  onOpen: () => void;
  onStatus: (id: string, s: TaskStatus) => void;
}) {
  const done = t.status === '完了';
  const overdue = !done && !!t.due && t.due < today;
  return (
    <article
      className={`group rise-in rounded-lg border bg-white px-2.5 py-2 shadow-sm transition-shadow hover:shadow-md ${
        overdue ? 'border-red-200' : 'border-slate-200'
      } ${done ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onStatus(t.id, done ? '進行中' : '完了')}
          aria-label={done ? `「${t.title}」を進行中に戻す` : `「${t.title}」を完了にする`}
          title={done ? '進行中に戻す' : '完了にする'}
          className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
            done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent hover:border-emerald-600 hover:text-emerald-600'
          } disabled:cursor-default`}
        >
          {done ? <Check size={10} strokeWidth={3} aria-hidden /> : <Check size={10} strokeWidth={3} aria-hidden />}
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" aria-label={`「${t.title}」を開く`}>
          <p className={`text-[13px] font-medium leading-snug text-slate-900 ${done ? 'line-through decoration-slate-400' : ''}`}>{t.title}</p>
          {t.doneDef && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">完了: {t.doneDef}</p>}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-6">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${PRIORITY_CLS[t.priority] ?? PRIORITY_CLS.P3}`}>{t.priority}</span>
        <DueChip due={t.due} today={today} done={done} />
        {t.impact && (
          <span className="text-[11px] text-slate-500" title={t.impact}>
            {t.impact.slice(0, 1)}
          </span>
        )}
        {t.status !== '完了' && t.status !== '未着手' && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{t.status}</span>
        )}
        {canEdit && !done && (
          <select
            value={t.status}
            onChange={(e) => onStatus(t.id, e.target.value as TaskStatus)}
            aria-label={`「${t.title}」の状態`}
            className="ml-auto rounded border border-transparent bg-transparent py-0 pl-1 pr-5 text-[11px] text-slate-500 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        {canEdit && done && (
          <button type="button" onClick={() => onStatus(t.id, '進行中')} className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900">
            <RotateCcw size={11} aria-hidden /> 再開
          </button>
        )}
      </div>
    </article>
  );
}

function NewTaskButton({
  options,
  defaultAssignee,
  defaultTeam,
  onDone,
}: {
  options: TaskOptions;
  defaultAssignee: string;
  defaultTeam?: string;
  onDone: (r: ActionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${btn.ghost} w-full justify-start text-xs`}>
        <Plus size={14} aria-hidden /> タスクを追加
      </button>
      <SlideOver open={open} title="タスクを追加" onClose={() => setOpen(false)}>
        {open && (
          <TaskForm
            options={options}
            task={null}
            defaults={{ assignee: defaultAssignee, team: defaultTeam }}
            canEdit
            onDone={(r) => {
              onDone(r);
              if (r.ok) setOpen(false);
            }}
          />
        )}
      </SlideOver>
    </>
  );
}

