'use client';

// 今日やること（本人向け）。390px 幅を第一に、1列・大きめのタップ領域で「完了／進行中／確認待ち」を一発で。
// 状態変更は useOptimistic で即反映し、サーバー結果（setTaskStatusAction）で確定 → router.refresh で並び直す。
import { useEffect, useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock, Check, Clock, Database, Flag, Hourglass, Inbox, Play, Settings2, StickyNote, Users } from 'lucide-react';
import { btn, EmptyState, Notice, SlideOver } from '@/components/ui';
import type { TaskStatus } from '@/lib/tasks-constants';
import type { TodayData, TodaySectionKey, TodayTask } from '@/lib/pro/today';
import { daysBetween, fmtDateJa, fmtDateTimeJa, fmtDue } from '@/lib/pro/format';
import TaskForm from '@/app/(app)/tasks/TaskForm';
import { setTaskStatusAction, type ActionResult } from '@/app/(app)/tasks/actions';

interface Props {
  data: TodayData;
  actorName: string;
  hasKintoneName: boolean;
  canEdit: boolean;
}

const SECTION_ICON: Record<TodaySectionKey, typeof Flag> = {
  overdue: AlertTriangle,
  dueToday: CalendarClock,
  waiting: Hourglass,
  requested: Inbox,
  p1: Flag,
  soon: Clock,
};

const SECTION_TONE: Record<TodaySectionKey, string> = {
  overdue: 'text-red-700',
  dueToday: 'text-amber-800',
  waiting: 'text-slate-700',
  requested: 'text-blue-900',
  p1: 'text-slate-900',
  soon: 'text-slate-700',
};

const PRIORITY_CLS: Record<string, string> = {
  P1: 'bg-red-600 text-white',
  P2: 'bg-blue-900 text-white',
  P3: 'bg-slate-200 text-slate-700',
  P4: 'bg-slate-100 text-slate-500',
};

type StatusMap = Record<string, TaskStatus>;
const keyOf = (t: TodayTask) => `${t.source}:${t.id}`;

export default function TodayView({ data, actorName, hasKintoneName, canEdit }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<TodayTask | null>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [, startTransition] = useTransition();
  const [overrides, applyStatus] = useOptimistic<StatusMap, { key: string; status: TaskStatus }>({}, (state, u) => ({ ...state, [u.key]: u.status }));

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  const setStatus = (t: TodayTask, status: TaskStatus) => {
    startTransition(async () => {
      applyStatus({ key: keyOf(t), status });
      const r = await setTaskStatusAction(t.id, status);
      setFlash(r);
      if (r.ok) router.refresh();
    });
  };

  const total = data.sections.reduce((n, s) => n + s.tasks.length, 0);
  const c = data.counts;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="rise-in">
        <p className="text-xs text-slate-500">{fmtDateJa(data.today)}</p>
        <h1 className="mt-0.5 text-lg font-bold text-slate-900">
          {data.greeting}、{actorName}さん
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {data.matched ? (
            <>
              担当者「{data.matchName}」のタスク。期限超過 → 本日期限 → 確認待ち → 依頼 → P1 → 3日以内 の順です。
            </>
          ) : (
            '本人のタスクをまだ結び付けられていません。'
          )}
        </p>
      </header>

      {data.notice && (
        <Notice tone={data.source === 'local' ? 'warn' : 'info'}>
          <span className="inline-flex items-center gap-1">
            <Database size={12} aria-hidden />
            {data.notice}
          </span>
        </Notice>
      )}
      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      {!data.matched && (
        <Notice tone="warn">
          {hasKintoneName ? (
            <>担当者名「{actorName}」に一致するタスクの担当者が見つかりません。</>
          ) : (
            <>
              担当者名（Kintoneタスク管理の「担当」表記）が未設定のため、あなたのタスクを特定できません。
              ログイン名「{actorName}」と前方一致する担当者もいませんでした。
            </>
          )}{' '}
          <Link href="/pro/settings" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
            <Settings2 size={12} aria-hidden />
            PRO設定で担当者名を設定
          </Link>
        </Notice>
      )}

      {data.matched && (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="今日の件数">
          <Stat label="期限超過" n={c.overdue} tone={c.overdue ? 'text-red-700' : 'text-slate-900'} />
          <Stat label="本日期限" n={c.dueToday} tone={c.dueToday ? 'text-amber-800' : 'text-slate-900'} />
          <Stat label="確認待ち" n={c.waiting} tone="text-slate-900" />
          <Stat label="未完了" n={c.openTotal} tone="text-slate-900" />
        </div>
      )}

      {data.matched && total === 0 && (
        <EmptyState
          title="今日は期限のあるタスクはありません。P1から着手"
          body={
            c.openTotal > 0
              ? `未完了は ${c.openTotal} 件あります。優先度の高いものから進めてください。`
              : '未完了のタスクはありません。新しいタスクは「追加」から、期限と完了の定義を決めて登録してください。'
          }
          action={
            <Link href="/tasks?filter=p1" className={btn.secondary}>
              タスク管理でP1を見る
            </Link>
          }
        />
      )}

      {data.sections.map((s) => {
        const Icon = SECTION_ICON[s.key];
        return (
          <section key={s.key} aria-labelledby={`sec-${s.key}`} className="rise-in">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 px-0.5">
              <h2 id={`sec-${s.key}`} className={`inline-flex items-center gap-1.5 text-sm font-bold ${SECTION_TONE[s.key]}`}>
                <Icon size={14} aria-hidden />
                {s.title}
                <span className="tabular rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{s.tasks.length}</span>
              </h2>
              <p className="truncate text-[11px] text-slate-500">{s.hint}</p>
            </div>
            <ul className="space-y-2">
              {s.tasks.map((t) => (
                <li key={keyOf(t)}>
                  <TodayCard
                    task={t}
                    status={overrides[keyOf(t)] ?? t.status}
                    today={data.today}
                    canEdit={canEdit}
                    onStatus={(st) => setStatus(t, st)}
                    onOpen={() => setEditing(t)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {data.team && (
        <section aria-label="今日のチーム状況" className="rise-in rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Users size={14} aria-hidden />
              今日のチーム状況 <span className="text-xs font-medium text-slate-500">{data.team.name}</span>
            </h2>
            <Link href={`/pro/teams/${data.team.code}`} className="text-xs font-medium text-blue-900 underline-offset-2 hover:underline">
              部署を見る
            </Link>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <TeamStat label="未完了" n={data.team.open} tone="text-slate-900" />
            <TeamStat label="期限超過" n={data.team.overdue} tone={data.team.overdue ? 'text-red-700' : 'text-slate-900'} />
            <TeamStat label="確認待ち" n={data.team.waiting} tone={data.team.waiting ? 'text-amber-800' : 'text-slate-900'} />
          </dl>
        </section>
      )}

      <section aria-label="最近のメモ" className="rise-in rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <StickyNote size={14} aria-hidden />
          最近のメモ
        </h2>
        {data.notes.length === 0 ? (
          <p className="mt-1.5 text-xs text-slate-500">まだメモはありません。右上の「追加」→「メモ」で1行だけ残せます。</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.notes.map((n) => (
              <li key={n.id} className="py-1.5">
                <p className="whitespace-pre-wrap text-[13px] leading-snug text-slate-800">{n.body}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{fmtDateTimeJa(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SlideOver open={editing !== null} title="タスクの詳細" onClose={() => setEditing(null)}>
        {editing && (
          <TaskForm
            key={keyOf(editing)}
            options={data.options}
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
        )}
      </SlideOver>
    </div>
  );
}

function Stat({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center shadow-sm">
      <p className={`tabular text-lg font-bold leading-tight ${tone}`}>{n}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}

function TeamStat({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1.5">
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className={`tabular text-base font-bold leading-tight ${tone}`}>{n}</dd>
    </div>
  );
}

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

function TodayCard({
  task: t,
  status,
  today,
  canEdit,
  onStatus,
  onOpen,
}: {
  task: TodayTask;
  status: TaskStatus;
  today: string;
  canEdit: boolean;
  onStatus: (s: TaskStatus) => void;
  onOpen: () => void;
}) {
  const done = status === '完了';
  const overdue = !done && !!t.due && t.due < today;
  return (
    <article className={`rounded-xl border bg-white px-3 py-2.5 shadow-sm ${overdue ? 'border-red-200' : 'border-slate-200'} ${done ? 'opacity-60' : ''}`}>
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`「${t.title}」の詳細を開く`}>
        <p className={`text-[14px] font-medium leading-snug text-slate-900 ${done ? 'line-through decoration-slate-400' : ''}`}>{t.title}</p>
        {t.doneDef && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">完了: {t.doneDef}</p>}
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${PRIORITY_CLS[t.priority] ?? PRIORITY_CLS.P3}`}>{t.priority}</span>
        <DueChip due={t.due} today={today} done={done} />
        {t.team && <span className="text-[11px] text-slate-500">{t.team}</span>}
        {t.isOthers && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-900">担当: {t.assignee}</span>}
        {t.requestedBy && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-900">依頼: {t.requestedBy}</span>}
        {status !== '未着手' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{status}</span>}
      </div>
      {canEdit && (
        <div className="mt-2 grid grid-cols-4 gap-1.5" role="group" aria-label={`「${t.title}」の操作`}>
          <button
            type="button"
            onClick={() => onStatus(done ? '進行中' : '完了')}
            className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-md border px-1 text-xs font-medium transition-colors ${
              done ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            <Check size={13} strokeWidth={3} aria-hidden />
            {done ? '戻す' : '完了'}
          </button>
          <button
            type="button"
            disabled={status === '進行中'}
            onClick={() => onStatus('進行中')}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
          >
            <Play size={12} aria-hidden />
            進行中
          </button>
          <button
            type="button"
            disabled={status === '確認待ち'}
            onClick={() => onStatus('確認待ち')}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
          >
            <Hourglass size={12} aria-hidden />
            確認待ち
          </button>
          <button type="button" onClick={onOpen} className="inline-flex min-h-9 items-center justify-center rounded-md px-1 text-xs font-medium text-blue-900 transition-colors hover:bg-slate-100">
            詳細
          </button>
        </div>
      )}
      {!canEdit && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={onOpen} className={`${btn.ghost} text-xs`}>
            詳細
          </button>
        </div>
      )}
    </article>
  );
}
