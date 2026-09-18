'use client';

// タスク2.0 の画面。タブ: ボトルネック（既定）／部署×状態／プロジェクト／一覧。
// 色は1アクセント（blue-900）。赤=期限超過・琥珀=確認待ち滞留・灰=保留 だけを例外として使う。
import { useActionState, useEffect, useMemo, useOptimistic, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Database, Grid3x3, KanbanSquare, List, PauseCircle, PlayCircle, Plus, Search } from 'lucide-react';
import { btn, EmptyState, Field, inputCls, Notice, SlideOver } from '@/components/ui';
import TaskForm from '@/app/(app)/tasks/TaskForm';
import type { TaskOptions } from '@/lib/tasks';
import { PRIORITIES } from '@/lib/tasks-constants';
import { TEAM_DEFS } from '@/lib/pro/teams';
import {
  priorityLabel,
  PROJECT_STATUS_JA,
  STATUSES2,
  type Bottlenecks,
  type LoadRow,
  type MatrixRow,
  type ProjectItem,
  type Status2,
  type StuckReason,
  type Task2Item,
} from '@/lib/pro/tasks2';
import { createProjectAction, holdTaskAction, linkProjectKpiAction, resumeAction, setProgressAction, type ActionResult } from './actions';

export type Tab = 'bottleneck' | 'matrix' | 'projects' | 'list';

export interface ListFilter {
  teamKey: string; // MatrixRow.key（teamCode か label:xxx）
  assignee: string;
  priority: string;
  status: Status2 | '' | 'open';
  due: '' | 'overdue' | 'today' | 'week' | 'none';
  projectCode: string;
  q: string;
}

interface Props {
  tasks: Task2Item[];
  options: TaskOptions;
  source: 'kintone' | 'local';
  notice: string | null;
  appId: string;
  canEdit: boolean;
  currentUserName: string;
  currentUserId: string;
  bottlenecks: Bottlenecks;
  matrix: MatrixRow[];
  projects: ProjectItem[];
  kpiOptions: { code: string; name: string }[];
  userOptions: { id: string; name: string }[];
  initialTab: Tab;
  initialFilter: Partial<ListFilter>;
}

const EMPTY_FILTER: ListFilter = { teamKey: '', assignee: '', priority: '', status: 'open', due: '', projectCode: '', q: '' };

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function fmtDue(due: string | null): string {
  if (!due) return '—';
  const [y, m, d] = due.split('-').map(Number);
  return `${m}/${d}(${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function teamKeyOf(t: Task2Item): string {
  return t.teamCode ?? `label:${t.team || '未設定'}`;
}

const REASON_CLS: Record<StuckReason, string> = {
  期限超過: 'bg-red-50 text-red-700 ring-red-200',
  確認待ち滞留: 'bg-amber-50 text-amber-800 ring-amber-200',
  保留: 'bg-slate-100 text-slate-600 ring-slate-300',
};
const STATUS_CLS: Record<Status2, string> = {
  未着手: 'bg-slate-100 text-slate-600',
  進行中: 'bg-blue-50 text-blue-900',
  確認待ち: 'bg-amber-50 text-amber-800',
  保留: 'bg-slate-200 text-slate-700',
  完了: 'bg-emerald-50 text-emerald-700',
};
const PRIORITY_CLS: Record<string, string> = {
  P1: 'bg-red-600 text-white',
  P2: 'bg-blue-900 text-white',
  P3: 'bg-slate-200 text-slate-700',
  P4: 'bg-slate-100 text-slate-500',
};

export default function Tasks2View(props: Props) {
  const { options, source, notice, appId, canEdit, bottlenecks, matrix, projects, kpiOptions, userOptions } = props;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const [filter, setFilter] = useState<ListFilter>({ ...EMPTY_FILTER, ...props.initialFilter });
  const [editing, setEditing] = useState<Task2Item | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [, startTransition] = useTransition();

  const [tasks, applyLocal] = useOptimistic(props.tasks, (state: Task2Item[], u: Partial<Task2Item> & { id: string }) =>
    state.map((t) => (t.id === u.id ? { ...t, ...u } : t)),
  );

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  const today = bottlenecks.today;

  const commitProgress = (id: string, progress: number) => {
    startTransition(async () => {
      applyLocal({ id, progress });
      setFlash(await setProgressAction(id, progress));
    });
  };
  const resume = (id: string) => {
    startTransition(async () => {
      applyLocal({ id, holdReason: null, displayStatus: '進行中', status: '進行中' });
      setFlash(await resumeAction(id));
    });
  };

  const goList = (f: Partial<ListFilter>) => {
    setFilter({ ...EMPTY_FILTER, ...f });
    setTab('list');
  };

  const visible = useMemo(() => {
    const kw = filter.q.trim().toLowerCase();
    return tasks
      .filter((t) => {
        if (filter.teamKey && teamKeyOf(t) !== filter.teamKey) return false;
        if (filter.assignee && (t.assignee || '未割当') !== filter.assignee) return false;
        if (filter.priority && t.priority !== filter.priority) return false;
        if (filter.status === 'open' ? t.displayStatus === '完了' : filter.status && t.displayStatus !== filter.status) return false;
        if (filter.projectCode && t.projectCode !== filter.projectCode) return false;
        if (filter.due === 'overdue' && !(t.due && t.due < today && t.displayStatus !== '完了')) return false;
        if (filter.due === 'today' && t.due !== today) return false;
        if (filter.due === 'week' && !(t.due && t.due >= today && t.due <= addDays(today, 7))) return false;
        if (filter.due === 'none' && t.due) return false;
        if (kw && !`${t.title} ${t.doneDef} ${t.assignee} ${t.team} ${t.memo} ${t.projectCode ?? ''}`.toLowerCase().includes(kw)) return false;
        return true;
      })
      .sort((a, b) => (a.displayStatus === '完了' ? 1 : 0) - (b.displayStatus === '完了' ? 1 : 0) || a.priority.localeCompare(b.priority) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  }, [tasks, filter, today]);

  const teamChoices = useMemo(() => matrix.map((r) => ({ key: r.key, label: r.label })), [matrix]);
  const assigneeChoices = useMemo(() => [...new Set(tasks.map((t) => t.assignee || '未割当'))].sort((a, b) => a.localeCompare(b, 'ja')), [tasks]);

  const tabs: { key: Tab; label: string; icon: ReactNode; n?: number }[] = [
    { key: 'bottleneck', label: 'ボトルネック', icon: <AlertTriangle size={13} aria-hidden />, n: bottlenecks.stuck.length },
    { key: 'matrix', label: '部署×状態', icon: <Grid3x3 size={13} aria-hidden /> },
    { key: 'projects', label: 'プロジェクト', icon: <KanbanSquare size={13} aria-hidden />, n: projects.length },
    { key: 'list', label: '一覧', icon: <List size={13} aria-hidden /> },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">タスク2.0</h1>
          <p className="mt-0.5 text-xs text-slate-500">誰の仕事が止まっているかを先に見る。優先度は 緊急/高/中/低 = P1〜P4、状態に「保留」を追加。</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
            source === 'kintone' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'
          }`}
        >
          <Database size={12} aria-hidden />
          {source === 'kintone' ? `Kintone タスク管理(${appId}) 接続中` : 'Kintone 未接続・ローカル保存'}
        </span>
      </header>

      {notice && <Notice tone={source === 'local' ? 'warn' : 'info'}>{notice}</Notice>}
      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      <div className="inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="表示">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.icon}
            {t.label}
            {t.n != null && <span className="tabular text-slate-500">{t.n}</span>}
          </button>
        ))}
      </div>

      {tab === 'bottleneck' && (
        <BottleneckTab b={bottlenecks} canEdit={canEdit} onOpen={setEditing} onResume={resume} onPerson={(name) => goList({ assignee: name })} onTeam={(key) => goList({ teamKey: key })} />
      )}
      {tab === 'matrix' && <MatrixTab rows={matrix} onCell={(key, status) => goList({ teamKey: key, status })} />}
      {tab === 'projects' && (
        <ProjectsTab projects={projects} canEdit={canEdit} onNew={() => setNewProject(true)} onOpen={(code) => goList({ projectCode: code, status: 'open' })} />
      )}
      {tab === 'list' && (
        <ListTab
          tasks={visible}
          total={tasks.length}
          filter={filter}
          setFilter={setFilter}
          teamChoices={teamChoices}
          assigneeChoices={assigneeChoices}
          projects={projects}
          today={today}
          canEdit={canEdit}
          onOpen={setEditing}
          onProgress={commitProgress}
          onResume={resume}
        />
      )}

      <SlideOver open={editing != null} title={editing ? `タスクを編集 — ${priorityLabel(editing.priority)}` : ''} onClose={() => setEditing(null)}>
        {editing && (
          <div className="space-y-5">
            <TaskForm
              options={options}
              task={editing}
              canEdit={canEdit}
              onDone={(r) => {
                setFlash(r);
                if (r.ok) {
                  setEditing(null);
                  router.refresh();
                }
              }}
            />
            <ProSection
              task={editing}
              canEdit={canEdit}
              projects={projects}
              kpiOptions={kpiOptions}
              onProgress={commitProgress}
              onDone={(r) => {
                setFlash(r);
                if (r.ok) {
                  setEditing(null);
                  router.refresh();
                }
              }}
            />
          </div>
        )}
      </SlideOver>

      <SlideOver open={newProject} title="プロジェクトを作成" onClose={() => setNewProject(false)}>
        <ProjectForm
          userOptions={userOptions}
          kpiOptions={kpiOptions}
          currentUserId={props.currentUserId}
          onDone={(r) => {
            setFlash(r);
            if (r.ok) {
              setNewProject(false);
              router.refresh();
            }
          }}
        />
      </SlideOver>
    </div>
  );
}

// ---------- ボトルネック ----------
function BottleneckTab({
  b,
  canEdit,
  onOpen,
  onResume,
  onPerson,
  onTeam,
}: {
  b: Bottlenecks;
  canEdit: boolean;
  onOpen: (t: Task2Item) => void;
  onResume: (id: string) => void;
  onPerson: (name: string) => void;
  onTeam: (key: string) => void;
}) {
  const counts = {
    overdue: b.stuck.filter((s) => s.reasons.includes('期限超過')).length,
    stale: b.stuck.filter((s) => s.reasons.includes('確認待ち滞留')).length,
    held: b.stuck.filter((s) => s.reasons.includes('保留')).length,
  };
  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-bold text-slate-900">
            止まっている仕事 <span className="tabular text-slate-500">{b.stuck.length}</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            期限超過 <b className="tabular text-red-700">{counts.overdue}</b> ・ 確認待ち滞留（4日以上動きなし）{' '}
            <b className="tabular text-amber-800">{counts.stale}</b> ・ 保留 <b className="tabular text-slate-700">{counts.held}</b>
          </p>
        </header>
        {b.stuck.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">止まっている仕事はありません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">理由</th>
                  <th className="px-2 py-2 text-right font-medium">日数</th>
                  <th className="px-2 py-2 text-left font-medium">タスク</th>
                  <th className="px-2 py-2 text-left font-medium">担当</th>
                  <th className="px-2 py-2 text-left font-medium">部署</th>
                  <th className="px-2 py-2 text-left font-medium">優先度</th>
                  <th className="px-2 py-2 text-left font-medium">期限</th>
                  <th className="px-2 py-2 text-left font-medium">状態</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {b.stuck.map(({ task: t, reasons, days }) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {reasons.map((r) => (
                          <span key={r} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${REASON_CLS[r]}`}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="tabular px-2 py-2 text-right font-semibold text-slate-800">{days}日</td>
                    <td className="max-w-[280px] px-2 py-2">
                      <button type="button" onClick={() => onOpen(t)} className="line-clamp-2 text-left font-medium text-slate-900 hover:underline">
                        {t.title}
                      </button>
                      {t.holdReason && <p className="mt-0.5 truncate text-[11px] text-slate-500">保留理由: {t.holdReason}</p>}
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onPerson(t.assignee || '未割当')} className="text-slate-700 hover:underline">
                        {t.assignee || '未割当'}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onTeam(teamKeyOf(t))} className="text-slate-600 hover:underline">
                        {t.teamName}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <PriorityChip code={t.priority} />
                    </td>
                    <td className="tabular px-2 py-2 text-slate-700">{fmtDue(t.due)}</td>
                    <td className="px-2 py-2">
                      <StatusChip s={t.displayStatus} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && t.displayStatus === '保留' ? (
                        <button type="button" onClick={() => onResume(t.id)} className={btn.ghost} title="保留を解除して進行中に戻す">
                          <PlayCircle size={13} aria-hidden />
                          再開
                        </button>
                      ) : (
                        <button type="button" onClick={() => onOpen(t)} className={btn.ghost}>
                          開く
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <LoadPanel title="担当者別の負荷" rows={b.byAssignee} onPick={onPerson} />
        <LoadPanel title="部署別の負荷" rows={b.byTeam} onPick={onTeam} />
      </div>
    </div>
  );
}

function LoadPanel({ title, rows, onPick }: { title: string; rows: LoadRow[]; onPick: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.open));
  return (
    <section className="rounded-xl bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <p className="text-[11px] text-slate-500">
          <span className="mr-2 inline-block h-2 w-2 rounded-sm bg-red-500 align-middle" />
          期限超過
          <span className="ml-3 mr-2 inline-block h-2 w-2 rounded-sm bg-amber-400 align-middle" />
          確認待ち滞留
          <span className="ml-3 mr-2 inline-block h-2 w-2 rounded-sm bg-slate-400 align-middle" />
          保留
          <span className="ml-3 mr-2 inline-block h-2 w-2 rounded-sm bg-blue-900 align-middle" />
          その他
        </p>
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-slate-500">未完了タスクはありません。</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => {
            const other = Math.max(0, r.open - r.overdue - r.waitingStale - r.held);
            const w = (n: number) => `${(n / max) * 100}%`;
            return (
              <li key={r.key} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 px-4 py-2 text-xs">
                <button type="button" onClick={() => onPick(r.key)} className="truncate text-left font-medium text-slate-800 hover:underline" title={r.label}>
                  {r.label}
                </button>
                <div className="flex h-3 w-full overflow-hidden rounded-sm bg-slate-100" role="img" aria-label={`未完了 ${r.open}件（期限超過 ${r.overdue}・確認待ち滞留 ${r.waitingStale}・保留 ${r.held}）`}>
                  {r.overdue > 0 && <span className="h-full bg-red-500" style={{ width: w(r.overdue) }} />}
                  {r.waitingStale > 0 && <span className="h-full bg-amber-400" style={{ width: w(r.waitingStale) }} />}
                  {r.held > 0 && <span className="h-full bg-slate-400" style={{ width: w(r.held) }} />}
                  {other > 0 && <span className="h-full bg-blue-900" style={{ width: w(other) }} />}
                </div>
                <div className="tabular whitespace-nowrap text-right text-[11px] text-slate-600">
                  <b className="text-slate-900">{r.open}</b>件
                  {r.overdue > 0 && <span className="ml-1.5 text-red-700">超過{r.overdue}</span>}
                  {r.waitingStale > 0 && <span className="ml-1.5 text-amber-800">滞留{r.waitingStale}</span>}
                  {r.held > 0 && <span className="ml-1.5 text-slate-600">保留{r.held}</span>}
                  <span className="ml-1.5 text-slate-400">{r.lastActivityDays == null ? '更新日不明' : r.lastActivityDays === 0 ? '今日更新' : `${r.lastActivityDays}日前`}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------- 部署×状態 ----------
function MatrixTab({ rows, onCell }: { rows: MatrixRow[]; onCell: (key: string, status: Status2) => void }) {
  const totals = STATUSES2.reduce((acc, s) => ({ ...acc, [s]: rows.reduce((a, r) => a + r.counts[s], 0) }), {} as Record<Status2, number>);
  const grand = rows.reduce((a, r) => a + r.total, 0);
  return (
    <section className="rounded-xl bg-white shadow-sm">
      <header className="border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">部署×状態</h2>
        <p className="text-[11px] text-slate-500">数字をクリックすると、その部署・状態で一覧に絞り込みます。</p>
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-slate-500">タスクがありません。</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">部署</th>
                {STATUSES2.map((s) => (
                  <th key={s} className="px-2 py-2 text-right font-medium">
                    {s}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">合計</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="px-4 py-1.5 font-medium text-slate-800">{r.label}</td>
                  {STATUSES2.map((s) => (
                    <td key={s} className="tabular px-2 py-1.5 text-right">
                      {r.counts[s] > 0 ? (
                        <button
                          type="button"
                          onClick={() => onCell(r.key, s)}
                          className={`rounded px-1.5 py-0.5 font-semibold hover:underline ${
                            s === '保留' || s === '確認待ち' ? 'text-amber-800' : s === '完了' ? 'text-slate-500' : 'text-blue-900'
                          }`}
                        >
                          {r.counts[s]}
                        </button>
                      ) : (
                        <span className="text-slate-300">·</span>
                      )}
                    </td>
                  ))}
                  <td className="tabular px-4 py-1.5 text-right font-semibold text-slate-900">{r.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700">
              <tr>
                <td className="px-4 py-2">合計</td>
                {STATUSES2.map((s) => (
                  <td key={s} className="tabular px-2 py-2 text-right">
                    {totals[s]}
                  </td>
                ))}
                <td className="tabular px-4 py-2 text-right">{grand}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- プロジェクト ----------
function ProjectsTab({ projects, canEdit, onNew, onOpen }: { projects: ProjectItem[]; canEdit: boolean; onNew: () => void; onOpen: (code: string) => void }) {
  return (
    <section className="rounded-xl bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-bold text-slate-900">プロジェクト</h2>
          <p className="text-[11px] text-slate-500">進捗率は紐づくタスクの平均（完了=100%）。タスクの紐づけは各タスクの編集パネルから。</p>
        </div>
        {canEdit && (
          <button type="button" onClick={onNew} className={btn.primary}>
            <Plus size={14} aria-hidden />
            新規
          </button>
        )}
      </header>
      {projects.length === 0 ? (
        <div className="p-4">
          <EmptyState title="プロジェクトはまだありません" body="複数タスクをまとめる単位です。名前・部署・責任者・期限・目標を決めて作成してください。" action={canEdit ? <button type="button" onClick={onNew} className={btn.primary}>プロジェクトを作成</button> : undefined} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">プロジェクト</th>
                <th className="px-2 py-2 text-left font-medium">部署</th>
                <th className="px-2 py-2 text-left font-medium">責任者</th>
                <th className="px-2 py-2 text-left font-medium">期限</th>
                <th className="px-2 py-2 text-left font-medium">状態</th>
                <th className="px-2 py-2 text-left font-medium">進捗</th>
                <th className="px-4 py-2 text-right font-medium">タスク</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => onOpen(p.code)} className="text-left font-medium text-slate-900 hover:underline">
                      {p.name}
                    </button>
                    <p className="text-[11px] text-slate-500">
                      <code>{p.code}</code>
                      {p.goal && <span className="ml-2">{p.goal}</span>}
                    </p>
                  </td>
                  <td className="px-2 py-2 text-slate-700">{p.teamName}</td>
                  <td className="px-2 py-2 text-slate-700">{p.ownerName ?? '未設定'}</td>
                  <td className="tabular px-2 py-2 text-slate-700">{fmtDue(p.dueDate)}</td>
                  <td className="px-2 py-2 text-slate-700">{PROJECT_STATUS_JA[p.status] ?? p.status}</td>
                  <td className="px-2 py-2">
                    <ProgressBar value={p.progress} />
                  </td>
                  <td className="tabular px-4 py-2 text-right text-slate-700">
                    {p.openCount}/{p.taskCount}
                    {p.overdue > 0 && <span className="ml-1.5 text-red-700">超過{p.overdue}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProjectForm({
  userOptions,
  kpiOptions,
  currentUserId,
  onDone,
}: {
  userOptions: { id: string; name: string }[];
  kpiOptions: { code: string; name: string }[];
  currentUserId: string;
  onDone: (r: ActionResult) => void;
}) {
  const [result, formAction, pending] = useActionState(createProjectAction, null);
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  return (
    <form action={formAction} className="space-y-3">
      <Field label="プロジェクト名" required hint="コードは名前から自動で付きます（英数字があればそのスラッグ、無ければ prj-日付）">
        <input name="name" required maxLength={80} className={inputCls} placeholder="例: 楽天スーパーSALE 9月" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="部署">
          <select name="teamCode" className={inputCls} defaultValue="">
            <option value="">未設定</option>
            {TEAM_DEFS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="責任者">
          <select name="ownerUserId" className={inputCls} defaultValue={currentUserId}>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="期限">
          <input name="dueDate" type="date" className={`${inputCls} tabular`} />
        </Field>
        <Field label="関連KPI">
          <select name="kpiCode" className={inputCls} defaultValue="">
            <option value="">なし</option>
            {kpiOptions.map((k) => (
              <option key={k.code} value={k.code}>
                {k.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="目標" hint="数字で。例: 期間売上 ¥25,000,000・CPA ¥4,500以下">
        <textarea name="goal" rows={2} maxLength={400} className={inputCls} />
      </Field>
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? '作成中…' : '作成'}
        </button>
      </div>
    </form>
  );
}

// ---------- 一覧 ----------
function ListTab({
  tasks,
  total,
  filter,
  setFilter,
  teamChoices,
  assigneeChoices,
  projects,
  today,
  canEdit,
  onOpen,
  onProgress,
  onResume,
}: {
  tasks: Task2Item[];
  total: number;
  filter: ListFilter;
  setFilter: (f: ListFilter) => void;
  teamChoices: { key: string; label: string }[];
  assigneeChoices: string[];
  projects: ProjectItem[];
  today: string;
  canEdit: boolean;
  onOpen: (t: Task2Item) => void;
  onProgress: (id: string, v: number) => void;
  onResume: (id: string) => void;
}) {
  const set = (k: keyof ListFilter, v: string) => setFilter({ ...filter, [k]: v });
  const sel = `${inputCls} w-auto py-1`;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select value={filter.teamKey} onChange={(e) => set('teamKey', e.target.value)} className={sel} aria-label="部署">
            <option value="">すべての部署</option>
            {teamChoices.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <select value={filter.assignee} onChange={(e) => set('assignee', e.target.value)} className={sel} aria-label="担当者">
            <option value="">すべての担当</option>
            {assigneeChoices.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select value={filter.priority} onChange={(e) => set('priority', e.target.value)} className={sel} aria-label="優先度">
            <option value="">すべての優先度</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(p)}
              </option>
            ))}
          </select>
          <select value={filter.status} onChange={(e) => set('status', e.target.value)} className={sel} aria-label="状態">
            <option value="open">未完了すべて</option>
            <option value="">完了も含む</option>
            {STATUSES2.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={filter.due} onChange={(e) => set('due', e.target.value)} className={sel} aria-label="期限">
            <option value="">すべての期限</option>
            <option value="overdue">期限超過</option>
            <option value="today">本日期限</option>
            <option value="week">7日以内</option>
            <option value="none">期限なし</option>
          </select>
          {projects.length > 0 && (
            <select value={filter.projectCode} onChange={(e) => set('projectCode', e.target.value)} className={sel} aria-label="プロジェクト">
              <option value="">すべてのプロジェクト</option>
              {projects.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <label className="relative ml-auto block w-full sm:w-56">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="search" value={filter.q} onChange={(e) => set('q', e.target.value)} placeholder="検索" aria-label="タスクを検索" className={`${inputCls} pl-8`} />
          </label>
          <span className="tabular text-[11px] text-slate-500">
            {tasks.length}/{total}件
          </span>
          {JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER) && (
            <button type="button" onClick={() => setFilter(EMPTY_FILTER)} className={btn.ghost}>
              絞り込みを外す
            </button>
          )}
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState title="条件に合うタスクはありません" body="絞り込みを変えるか、右上の「追加」からタスクを登録してください。" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">優先度</th>
                <th className="px-2 py-2 text-left font-medium">タスク</th>
                <th className="px-2 py-2 text-left font-medium">担当</th>
                <th className="px-2 py-2 text-left font-medium">部署</th>
                <th className="px-2 py-2 text-left font-medium">期限</th>
                <th className="px-2 py-2 text-left font-medium">状態</th>
                <th className="w-44 px-2 py-2 text-left font-medium">進捗</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => {
                const done = t.displayStatus === '完了';
                const overdue = !done && t.due && t.due < today;
                return (
                  <tr key={t.id} className={`hover:bg-slate-50 ${done ? 'text-slate-400' : ''}`}>
                    <td className="px-3 py-2">
                      <PriorityChip code={t.priority} />
                    </td>
                    <td className="max-w-[320px] px-2 py-2">
                      <button type="button" onClick={() => onOpen(t)} className={`line-clamp-2 text-left font-medium hover:underline ${done ? 'text-slate-500' : 'text-slate-900'}`}>
                        {t.title}
                      </button>
                      <p className="truncate text-[11px] text-slate-500">
                        {t.projectCode && <span className="mr-2 rounded bg-slate-100 px-1 text-slate-600">{projects.find((p) => p.code === t.projectCode)?.name ?? t.projectCode}</span>}
                        {t.kpiCode && <span className="mr-2 rounded bg-slate-100 px-1 text-slate-600">KPI: {t.kpiCode}</span>}
                        {t.doneDef}
                      </p>
                    </td>
                    <td className="px-2 py-2 text-slate-700">{t.assignee || '未割当'}</td>
                    <td className="px-2 py-2 text-slate-600">{t.teamName}</td>
                    <td className={`tabular px-2 py-2 ${overdue ? 'font-semibold text-red-700' : 'text-slate-700'}`}>{fmtDue(t.due)}</td>
                    <td className="px-2 py-2">
                      <StatusChip s={t.displayStatus} />
                    </td>
                    <td className="px-2 py-2">
                      <ProgressSlider id={t.id} value={t.progress} disabled={!canEdit || done} onCommit={onProgress} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {canEdit && t.displayStatus === '保留' && (
                          <button type="button" onClick={() => onResume(t.id)} className={btn.ghost} title="保留を解除">
                            <PlayCircle size={13} aria-hidden />
                            再開
                          </button>
                        )}
                        <button type="button" onClick={() => onOpen(t)} className={btn.ghost}>
                          編集
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProgressSlider({ id, value, disabled, onCommit }: { id: string; value: number; disabled: boolean; onCommit: (id: string, v: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const v = draft ?? value;
  const commit = () => {
    if (draft != null && draft !== value) onCommit(id, draft);
    setDraft(null);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={v}
        disabled={disabled}
        aria-label="進捗率"
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-1.5 w-28 cursor-pointer accent-blue-900 disabled:cursor-not-allowed"
      />
      <span className="tabular w-9 text-right text-[11px] text-slate-600">{v}%</span>
    </div>
  );
}

// ---------- 編集パネルの PRO 項目 ----------
function ProSection({
  task: t,
  canEdit,
  projects,
  kpiOptions,
  onProgress,
  onDone,
}: {
  task: Task2Item;
  canEdit: boolean;
  projects: ProjectItem[];
  kpiOptions: { code: string; name: string }[];
  onProgress: (id: string, v: number) => void;
  onDone: (r: ActionResult) => void;
}) {
  const [projectCode, setProjectCode] = useState(t.projectCode ?? '');
  const [kpiCode, setKpiCode] = useState(t.kpiCode ?? '');
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const done = t.displayStatus === '完了';

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <h3 className="text-xs font-bold text-slate-700">PRO項目（このダッシュボードだけに保存・Kintoneには書きません）</h3>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-600">
          優先度 <b>{priorityLabel(t.priority)}</b>
          {t.requestedBy && <span className="ml-3 text-slate-500">依頼元: {t.requestedBy}</span>}
        </span>
        <StatusChip s={t.displayStatus} />
      </div>
      <Field label="進捗率">
        <ProgressSlider id={t.id} value={t.progress} disabled={!canEdit || done} onCommit={onProgress} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="プロジェクト">
          <select value={projectCode} onChange={(e) => setProjectCode(e.target.value)} disabled={!canEdit} className={inputCls}>
            <option value="">なし</option>
            {projects.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="関連KPI">
          <select value={kpiCode} onChange={(e) => setKpiCode(e.target.value)} disabled={!canEdit} className={inputCls}>
            <option value="">なし</option>
            {kpiOptions.map((k) => (
              <option key={k.code} value={k.code}>
                {k.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={pending || (projectCode === (t.projectCode ?? '') && kpiCode === (t.kpiCode ?? ''))}
            onClick={() =>
              start(async () => {
                const r = await linkProjectKpiAction(t.id, projectCode, kpiCode);
                if (r.ok) onDone(r);
                else setErr(r.message);
              })
            }
            className={btn.secondary}
          >
            紐づけを保存
          </button>
        </div>
      )}
      {canEdit && !done && (
        <div className="border-t border-slate-200 pt-3">
          {t.displayStatus === '保留' ? (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-600">保留中: {t.holdReason}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await resumeAction(t.id);
                    if (r.ok) onDone(r);
                    else setErr(r.message);
                  })
                }
                className={btn.secondary}
              >
                <PlayCircle size={13} aria-hidden />
                再開する
              </button>
            </div>
          ) : (
            <Field label="保留にする" hint="何を待っているかを書く。Kintone側は「確認待ち」＋備考に【保留】理由 が入ります">
              <div className="flex gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={inputCls} placeholder="例: 仕入先の見積待ち（9/25 回答予定）" />
                <button
                  type="button"
                  disabled={pending || !reason.trim()}
                  onClick={() =>
                    start(async () => {
                      const r = await holdTaskAction(t.id, reason);
                      if (r.ok) onDone(r);
                      else setErr(r.message);
                    })
                  }
                  className={`${btn.secondary} shrink-0`}
                >
                  <PauseCircle size={13} aria-hidden />
                  保留
                </button>
              </div>
            </Field>
          )}
        </div>
      )}
      {err && <Notice tone="error">{err}</Notice>}
    </section>
  );
}

// ---------- 小部品 ----------
function PriorityChip({ code }: { code: string }) {
  return <span className={`tabular inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY_CLS[code] ?? 'bg-slate-100 text-slate-600'}`}>{priorityLabel(code)}</span>;
}

function StatusChip({ s }: { s: Status2 }) {
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[s]}`}>{s}</span>;
}

function ProgressBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[11px] text-slate-400">タスクなし</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-sm bg-slate-100" role="img" aria-label={`進捗 ${value}%`}>
        <div className="h-full bg-blue-900" style={{ width: `${value}%` }} />
      </div>
      <span className="tabular text-[11px] text-slate-600">{value}%</span>
    </div>
  );
}
