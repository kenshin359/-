'use client';

// LINE監査役 管理画面（クライアント）。接続状態・グループ・メッセージ・追いかけ・定時投稿・監査ログ。
// 操作は manager 以上（サーバーアクションで再検証）。メッセージ本文はサーバーで落とされて null で届く場合がある。
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { AlertTriangle, Bell, CalendarClock, Check, ClipboardList, MessageSquare, Plug, Plus, RotateCcw, ScrollText, Trash2, Users, X } from 'lucide-react';
import { btn, inputCls, Field, Notice, EmptyState, SlideOver } from '@/components/ui';
import { fmtDateTimeJa, fmtDue } from '@/lib/pro/format';
import { PRIORITIES } from '@/lib/tasks-constants';
import type { FollowUpView, LineAdminData, ScheduledPostView } from './types';
import {
  completeFollowUpAction,
  createFollowUpAction,
  deletePostAction,
  dropFollowUpAction,
  followUpToTaskAction,
  reopenFollowUpAction,
  savePostAction,
  setFollowUpDueAction,
  setGroupActiveAction,
  setGroupTeamAction,
  togglePostAction,
  type ActionResult,
} from './actions';

type Tab = 'groups' | 'messages' | 'followups' | 'posts' | 'audit';

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: 'groups', label: 'グループ', icon: <Users size={14} aria-hidden /> },
  { key: 'messages', label: 'メッセージ', icon: <MessageSquare size={14} aria-hidden /> },
  { key: 'followups', label: '追いかけ', icon: <Bell size={14} aria-hidden /> },
  { key: 'posts', label: '定時投稿', icon: <CalendarClock size={14} aria-hidden /> },
  { key: 'audit', label: '監査ログ', icon: <ScrollText size={14} aria-hidden /> },
];

const TEMPLATE_JA: Record<string, string> = {
  daily_summary: 'まとめ（未完了の依頼＋本日期限）',
  due_reminder: '期限リマインド（超過＋本日）',
  custom: '定型文',
};

const STATUS_JA: Record<string, string> = { open: '未完了', done: '完了', dropped: '取り下げ' };

const ACTION_JA: Record<string, string> = {
  'line.followup.create': '依頼を記録',
  'line.followup.remind': '追いかけ送信',
  'line.followup.done': '完了',
  'line.followup.drop': '取り下げ',
  'line.followup.reopen': '未完了に戻す',
  'line.followup.due': '期限変更',
  'line.followup.task': 'タスク化',
  'line.group.join': 'グループ参加',
  'line.group.leave': 'グループ退出',
  'line.group.team': '部署割当',
  'line.group.active': '有効/停止',
  'line.post.create': '定時投稿を追加',
  'line.post.update': '定時投稿を変更',
  'line.post.toggle': '定時投稿 有効/停止',
  'line.post.delete': '定時投稿を削除',
  'line.post.sent': '定時投稿を送信',
  'line.post.skip': '定時投稿スキップ',
  'line.post.error': '定時投稿エラー',
};

function todayKey(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export default function LineAdmin({ data }: { data: LineAdminData }) {
  const [tab, setTab] = useState<Tab>(data.groups.length === 0 ? 'groups' : 'followups');
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>) => {
    startTransition(async () => {
      const r = await fn();
      setNotice(r);
    });
  };

  const openCount = data.followUps.filter((f) => f.status === 'open').length;
  const overdue = useMemo(() => {
    const t = todayKey();
    return data.followUps.filter((f) => f.status === 'open' && f.due && f.due < t).length;
  }, [data.followUps]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">LINE監査役</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            公式アカウントをチームのLINEグループに招待すると、依頼・期限・約束を記録し、未完了を自動で追いかけます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Stat label="グループ" value={`${data.groups.filter((g) => g.active).length}`} />
          <Stat label="未完了の追いかけ" value={`${openCount}`} tone={openCount ? 'warn' : 'ok'} />
          <Stat label="期限超過" value={`${overdue}`} tone={overdue ? 'danger' : 'ok'} />
        </div>
      </header>

      <ConnectionStatus data={data} />

      {notice && (
        <Notice tone={notice.ok ? 'ok' : 'error'}>
          <span className="flex items-center justify-between gap-2">
            {notice.message}
            <button type="button" className={btn.ghost} onClick={() => setNotice(null)} aria-label="閉じる">
              <X size={12} aria-hidden />
            </button>
          </span>
        </Notice>
      )}

      <nav className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="タブ">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
              tab === t.key ? 'border-blue-900 font-semibold text-blue-900' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.icon}
            {t.label}
            {t.key === 'followups' && openCount > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">{openCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div aria-busy={pending}>
        {tab === 'groups' && <GroupsTab data={data} run={run} />}
        {tab === 'messages' && <MessagesTab data={data} />}
        {tab === 'followups' && <FollowUpsTab data={data} run={run} />}
        {tab === 'posts' && <PostsTab data={data} run={run} />}
        {tab === 'audit' && <AuditTab data={data} />}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' }) {
  const cls = {
    neutral: 'border-slate-200 bg-white text-slate-800',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-800',
  }[tone];
  return (
    <div className={`rounded-md border px-3 py-1.5 ${cls}`}>
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className="ml-2 text-sm font-bold tabular-nums">{value}</span>
    </div>
  );
}

// ---------- 接続状態 ----------

function ConnectionStatus({ data }: { data: LineAdminData }) {
  if (data.configured && data.cronSecretConfigured) {
    return (
      <Notice tone="ok">
        <span className="inline-flex items-center gap-1.5">
          <Plug size={12} aria-hidden /> LINE Messaging API: 接続設定済み／定期処理（CRON_SECRET）: 設定済み。Webhook URL は{' '}
          <code className="rounded bg-white/70 px-1">/api/line/webhook</code>、定期処理は <code className="rounded bg-white/70 px-1">/api/line/cron</code>（10分おき）。
        </span>
      </Notice>
    );
  }
  return (
    <Notice tone="warn">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <AlertTriangle size={12} aria-hidden />
        {!data.configured && (
          <>
            LINE未接続: 環境変数 {data.envNames.map((n) => <code key={n} className="rounded bg-white/70 px-1">{n}</code>)} を設定してください。
          </>
        )}
        {!data.cronSecretConfigured && (
          <>
            定期処理（追いかけ・定時投稿）未設定: <code className="rounded bg-white/70 px-1">CRON_SECRET</code> を設定してください。
          </>
        )}
        手順は <code className="rounded bg-white/70 px-1">docs/line-setup.md</code>。
      </span>
    </Notice>
  );
}

// ---------- グループ ----------

function GroupsTab({ data, run }: { data: LineAdminData; run: (fn: () => Promise<ActionResult>) => void }) {
  if (data.groups.length === 0) {
    return (
      <EmptyState
        title="まだグループがありません"
        body="LINEで「監査役」公式アカウントをチームのグループに招待すると、ここに表示されます。招待前のメッセージは読めません。"
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">グループ</th>
            <th className="px-3 py-2 font-medium">部署</th>
            <th className="px-3 py-2 font-medium text-right">メッセージ</th>
            <th className="px-3 py-2 font-medium">最終受信</th>
            <th className="px-3 py-2 font-medium text-right">未完了</th>
            <th className="px-3 py-2 font-medium">状態</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.groups.map((g) => (
            <tr key={g.groupId} className={g.active ? '' : 'text-slate-400'}>
              <td className="px-3 py-2">
                <div className="font-medium text-slate-800">{g.name ?? '（名称未取得）'}</div>
                <div className="font-mono text-[10px] text-slate-400">{g.groupId.slice(0, 10)}…</div>
              </td>
              <td className="px-3 py-2">
                {data.canManage ? (
                  <select
                    className={inputCls}
                    value={g.teamCode ?? ''}
                    aria-label={`${g.name ?? g.groupId} の部署`}
                    onChange={(e) => run(() => setGroupTeamAction({ groupId: g.groupId, teamCode: e.target.value }))}
                  >
                    <option value="">未設定</option>
                    {data.teamOptions.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  g.teamName ?? '未設定'
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{g.messageCount}</td>
              <td className="px-3 py-2 text-xs">{fmtDateTimeJa(g.lastMessageAt)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{g.openFollowUps}</td>
              <td className="px-3 py-2">
                {data.canManage ? (
                  <button
                    type="button"
                    className={g.active ? btn.secondary : btn.primary}
                    onClick={() => run(() => setGroupActiveAction({ groupId: g.groupId, active: !g.active }))}
                  >
                    {g.active ? '停止' : '有効化'}
                  </button>
                ) : (
                  <span className="text-xs">{g.active ? '有効' : '停止'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- メッセージ ----------

function MessagesTab({ data }: { data: LineAdminData }) {
  const [groupId, setGroupId] = useState<string>(data.groups[0]?.groupId ?? '');
  const list = data.messages.filter((m) => !groupId || m.groupId === groupId).slice(0, 100);
  if (data.groups.length === 0) return <EmptyState title="グループがありません" body="グループ参加後にメッセージが保存されます。" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inputCls} max-w-xs`} value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="グループ">
          {data.groups.map((g) => (
            <option key={g.groupId} value={g.groupId}>
              {g.name ?? g.groupId.slice(0, 10)}
            </option>
          ))}
        </select>
        {!data.canManage && <span className="text-xs text-slate-500">本文は管理職以上のみ表示（件数・時刻のみ）</span>}
      </div>
      {list.length === 0 ? (
        <EmptyState title="メッセージがありません" body="招待後に届いたテキストがここに並びます（直近100件）。" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
          {list.map((m) => (
            <li key={m.id} className="flex gap-3 px-3 py-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-slate-500">{fmtDateTimeJa(m.ts)}</span>
              <span className="w-20 shrink-0 truncate text-xs font-medium text-slate-700">{m.displayName ?? '（不明）'}</span>
              <span className="min-w-0 flex-1 break-words text-slate-800">
                {m.kind !== 'text' ? <span className="text-slate-400">[{m.kind}]</span> : m.text ?? <span className="text-slate-400">（本文非表示）</span>}
              </span>
              <span className="shrink-0 text-[10px]">
                {m.extracted?.completion && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">完了報告</span>}
                {m.extracted?.followUpId && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">依頼</span>}
                {m.extracted?.confidence === 'low' && !m.extracted.followUpId && (
                  <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">候補(低)</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- 追いかけ ----------

function FollowUpsTab({ data, run }: { data: LineAdminData; run: (fn: () => Promise<ActionResult>) => void }) {
  const [status, setStatus] = useState<'open' | 'done' | 'dropped' | 'all'>('open');
  const [editing, setEditing] = useState<FollowUpView | null>(null);
  const [toTask, setToTask] = useState<FollowUpView | null>(null);
  const [adding, setAdding] = useState(false);
  const today = todayKey();
  const list = data.followUps.filter((f) => status === 'all' || f.status === status);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 text-xs">
          {(['open', 'done', 'dropped', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-md px-2.5 py-1 ${status === s ? 'bg-blue-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
            >
              {s === 'all' ? 'すべて' : STATUS_JA[s]}
            </button>
          ))}
        </div>
        {data.canManage && data.groups.length > 0 && (
          <button type="button" className={btn.secondary} onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden /> 手動で追加
          </button>
        )}
      </div>
      {data.tasksNotice && <Notice tone="info">タスク化先: {data.tasksNotice}</Notice>}

      {list.length === 0 ? (
        <EmptyState title="該当する追いかけはありません" body="グループの「〜お願いします」「〜までに」などから自動で記録されます。" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">内容</th>
                <th className="px-3 py-2 font-medium">担当</th>
                <th className="px-3 py-2 font-medium">期限</th>
                <th className="px-3 py-2 font-medium">追いかけ</th>
                <th className="px-3 py-2 font-medium">状態</th>
                {data.canManage && <th className="px-3 py-2 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((f) => {
                const isOverdue = f.status === 'open' && f.due && f.due < today;
                return (
                  <tr key={f.id} className={f.status !== 'open' ? 'text-slate-400' : ''}>
                    <td className="px-3 py-2">
                      <div className={`font-medium ${f.status === 'open' ? 'text-slate-800' : ''}`}>{f.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {f.groupName ?? '（グループ不明）'} ・ {fmtDateTimeJa(f.createdAt)}
                        {f.taskId && <span className="ml-1 rounded bg-blue-50 px-1 text-blue-800">タスク化済 {f.taskId}</span>}
                      </div>
                      {f.sourceText && f.sourceText !== f.title && (
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">元: {f.sourceText}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{f.assigneeName ?? <span className="text-amber-700">未定</span>}</td>
                    <td className={`px-3 py-2 tabular-nums ${isOverdue ? 'font-semibold text-red-700' : ''}`}>
                      {f.due ? fmtDue(f.due) : <span className="text-slate-400">なし</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {f.status === 'open' ? (
                        <>
                          {f.remindedCount}回
                          {f.remindAt ? <div className="text-slate-500">次: {fmtDateTimeJa(f.remindAt)}</div> : f.remindedCount >= 5 ? <div className="text-red-700">上限（要対応）</div> : null}
                        </>
                      ) : (
                        `${f.remindedCount}回`
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          f.status === 'open' ? 'bg-amber-100 text-amber-800' : f.status === 'done' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {STATUS_JA[f.status] ?? f.status}
                      </span>
                    </td>
                    {data.canManage && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {f.status === 'open' ? (
                            <>
                              {!f.taskId && (
                                <button type="button" className={btn.primary} onClick={() => setToTask(f)}>
                                  <ClipboardList size={12} aria-hidden /> タスク化
                                </button>
                              )}
                              <button type="button" className={btn.secondary} onClick={() => run(() => completeFollowUpAction(f.id))}>
                                <Check size={12} aria-hidden /> 完了
                              </button>
                              <button type="button" className={btn.secondary} onClick={() => setEditing(f)}>
                                期限変更
                              </button>
                              <button
                                type="button"
                                className={btn.danger}
                                onClick={() => {
                                  if (confirm(`「${f.title}」を取り下げますか？`)) run(() => dropFollowUpAction(f.id));
                                }}
                              >
                                取り下げ
                              </button>
                            </>
                          ) : (
                            <button type="button" className={btn.ghost} onClick={() => run(() => reopenFollowUpAction(f.id))}>
                              <RotateCcw size={12} aria-hidden /> 未完了に戻す
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DueEditor item={editing} onClose={() => setEditing(null)} run={run} />
      <ToTaskEditor item={toTask} data={data} onClose={() => setToTask(null)} run={run} />
      <NewFollowUpEditor open={adding} data={data} onClose={() => setAdding(false)} run={run} />
    </div>
  );
}

function DueEditor({ item, onClose, run }: { item: FollowUpView | null; onClose: () => void; run: (fn: () => Promise<ActionResult>) => void }) {
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const key = item?.id ?? '';
  // 開くたびに初期値を入れる
  const [seen, setSeen] = useState('');
  if (item && seen !== key) {
    setSeen(key);
    setDue(item.due ?? '');
    setAssignee(item.assigneeName ?? '');
  }
  return (
    <SlideOver
      open={Boolean(item)}
      title="期限・担当を変更"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className={btn.primary}
            onClick={() => {
              if (!item) return;
              run(() => setFollowUpDueAction({ id: item.id, due: due || null, assigneeName: assignee }));
              onClose();
            }}
          >
            保存
          </button>
        </div>
      }
    >
      {item && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-800">{item.title}</p>
          <Field label="期限" hint="空にすると期限なし（3日後に追いかけ）。変更すると追いかけ回数はリセット">
            <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="担当（表示名）">
            <input className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="例: 角南" />
          </Field>
        </div>
      )}
    </SlideOver>
  );
}

function ToTaskEditor({
  item,
  data,
  onClose,
  run,
}: {
  item: FollowUpView | null;
  data: LineAdminData;
  onClose: () => void;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const [team, setTeam] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('P2');
  const [seen, setSeen] = useState('');
  const key = item?.id ?? '';
  if (item && seen !== key) {
    setSeen(key);
    const label = item.teamCode ? data.teamOptions.find((t) => t.code === item.teamCode)?.kintoneLabel ?? '' : '';
    setTeam(label && data.taskTeams.includes(label) ? label : data.taskTeams[0] ?? '');
    const m = item.assigneeName ? data.members.find((x) => x.startsWith(item.assigneeName!) || item.assigneeName!.startsWith(x)) : undefined;
    setAssignee(m ?? '');
    setDue(item.due ?? '');
    setPriority('P2');
  }
  const canSave = Boolean(team && assignee && due);
  return (
    <SlideOver
      open={Boolean(item)}
      title="タスク化（Kintone タスク管理へ登録）"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className={btn.primary}
            disabled={!canSave}
            onClick={() => {
              if (!item) return;
              run(() => followUpToTaskAction({ id: item.id, team, assignee, due, priority }));
              onClose();
            }}
          >
            <ClipboardList size={14} aria-hidden /> 登録
          </button>
        </div>
      }
    >
      {item && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-800">{item.title}</p>
          <p className="text-xs text-slate-500">完了の定義はこの内容がそのまま入ります。必要なら登録後にタスク管理で数字に直してください。</p>
          <Field label="チーム" required>
            <select className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">選択</option>
              {data.taskTeams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="担当者" required>
            <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">選択</option>
              {data.members.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="期限" required>
            <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="優先度">
            <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </SlideOver>
  );
}

function NewFollowUpEditor({
  open,
  data,
  onClose,
  run,
}: {
  open: boolean;
  data: LineAdminData;
  onClose: () => void;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const [groupId, setGroupId] = useState(data.groups.find((g) => g.active)?.groupId ?? '');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  return (
    <SlideOver
      open={open}
      title="追いかけを手動で追加"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className={btn.primary}
            disabled={!groupId || !title.trim()}
            onClick={() => {
              run(() => createFollowUpAction({ groupId, title: title.trim(), assigneeName: assignee, due: due || null }));
              setTitle('');
              onClose();
            }}
          >
            追加
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="グループ" required>
          <select className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {data.groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.name ?? g.groupId.slice(0, 10)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="内容" required hint="80文字以内">
          <input className={inputCls} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="担当（表示名）">
          <input className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
        </Field>
        <Field label="期限" hint="空なら3日後に追いかけ">
          <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </SlideOver>
  );
}

// ---------- 定時投稿 ----------

const EMPTY_POST: Omit<ScheduledPostView, 'id' | 'groupName' | 'lastRunAt' | 'nextRunAt'> & { id?: string } = {
  groupId: '',
  name: '',
  cron: '0 8 * * 1-5',
  template: 'daily_summary',
  body: '',
  active: true,
};

function PostsTab({ data, run }: { data: LineAdminData; run: (fn: () => Promise<ActionResult>) => void }) {
  const [editing, setEditing] = useState<typeof EMPTY_POST | null>(null);
  if (data.groups.length === 0) return <EmptyState title="グループがありません" body="グループ参加後に定時投稿を設定できます。" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          cron は JST の5フィールド（分 時 日 月 曜日）。例: 平日朝8時 <code>0 8 * * 1-5</code>、毎日18時 <code>0 18 * * *</code>。定期処理は10分おきなので分は 0/10/20… を推奨。
        </p>
        {data.canManage && (
          <button type="button" className={btn.primary} onClick={() => setEditing({ ...EMPTY_POST, groupId: data.groups[0].groupId })}>
            <Plus size={14} aria-hidden /> 定時投稿を追加
          </button>
        )}
      </div>
      {data.posts.length === 0 ? (
        <EmptyState
          title="定時投稿はまだありません"
          body="「朝の予定（まとめ）」「夕方の期限リマインド」などを登録すると、グループへ自動投稿します。"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">名前</th>
                <th className="px-3 py-2 font-medium">グループ</th>
                <th className="px-3 py-2 font-medium">cron（JST）</th>
                <th className="px-3 py-2 font-medium">内容</th>
                <th className="px-3 py-2 font-medium">前回</th>
                <th className="px-3 py-2 font-medium">次回</th>
                {data.canManage && <th className="px-3 py-2 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.posts.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'text-slate-400'}>
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2">{p.groupName ?? p.groupId.slice(0, 10)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.cron}</td>
                  <td className="px-3 py-2 text-xs">{TEMPLATE_JA[p.template] ?? p.template}</td>
                  <td className="px-3 py-2 text-xs">{fmtDateTimeJa(p.lastRunAt)}</td>
                  <td className="px-3 py-2 text-xs">{p.active ? fmtDateTimeJa(p.nextRunAt) : '停止中'}</td>
                  {data.canManage && (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button type="button" className={btn.secondary} onClick={() => setEditing({ ...p, body: p.body ?? '' })}>
                          編集
                        </button>
                        <button type="button" className={btn.secondary} onClick={() => run(() => togglePostAction({ id: p.id, active: !p.active }))}>
                          {p.active ? '停止' : '有効化'}
                        </button>
                        <button
                          type="button"
                          className={btn.danger}
                          onClick={() => {
                            if (confirm(`「${p.name}」を削除しますか？`)) run(() => deletePostAction(p.id));
                          }}
                        >
                          <Trash2 size={12} aria-hidden />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PostEditor item={editing} data={data} onClose={() => setEditing(null)} run={run} />
    </div>
  );
}

function PostEditor({
  item,
  data,
  onClose,
  run,
}: {
  item: typeof EMPTY_POST | null;
  data: LineAdminData;
  onClose: () => void;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const [form, setForm] = useState(EMPTY_POST);
  const [seen, setSeen] = useState<string | null>(null);
  const key = item ? item.id ?? 'new' : null;
  if (item && seen !== key) {
    setSeen(key);
    setForm(item);
  }
  if (!item && seen !== null) setSeen(null);
  const set = <K extends keyof typeof EMPTY_POST>(k: K, v: (typeof EMPTY_POST)[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <SlideOver
      open={Boolean(item)}
      title={form.id ? '定時投稿を編集' : '定時投稿を追加'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className={btn.primary}
            onClick={() => {
              run(() =>
                savePostAction({
                  id: form.id,
                  groupId: form.groupId,
                  name: form.name,
                  cron: form.cron,
                  template: form.template as 'daily_summary' | 'due_reminder' | 'custom',
                  body: form.body ?? '',
                  active: form.active,
                }),
              );
              onClose();
            }}
          >
            保存
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="名前" required>
          <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例: 朝の予定" />
        </Field>
        <Field label="グループ" required>
          <select className={inputCls} value={form.groupId} onChange={(e) => set('groupId', e.target.value)}>
            {data.groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.name ?? g.groupId.slice(0, 10)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="cron（JST）" required hint="分 時 日 月 曜日。例: 0 8 * * 1-5（平日8:00）／0 18 * * *（毎日18:00）">
          <input className={`${inputCls} font-mono`} value={form.cron} onChange={(e) => set('cron', e.target.value)} />
        </Field>
        <Field label="内容" required>
          <select className={inputCls} value={form.template} onChange={(e) => set('template', e.target.value)}>
            {Object.entries(TEMPLATE_JA).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={form.template === 'custom' ? '本文' : '末尾に添える文（任意）'} required={form.template === 'custom'}>
          <textarea className={`${inputCls} min-h-24`} value={form.body ?? ''} onChange={(e) => set('body', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> 有効
        </label>
      </div>
    </SlideOver>
  );
}

// ---------- 監査ログ ----------

function AuditTab({ data }: { data: LineAdminData }) {
  if (data.audits.length === 0) return <EmptyState title="監査ログはまだありません" body="依頼の記録・追いかけ送信・完了・タスク化がここに時系列で残ります。" />;
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">日時</th>
            <th className="px-3 py-2 font-medium">操作</th>
            <th className="px-3 py-2 font-medium">実行者</th>
            <th className="px-3 py-2 font-medium">内容</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.audits.map((a) => (
            <tr key={a.id}>
              <td className="px-3 py-2 text-xs tabular-nums">{fmtDateTimeJa(a.createdAt)}</td>
              <td className="px-3 py-2 text-xs">{ACTION_JA[a.action] ?? a.action}</td>
              <td className="px-3 py-2 text-xs">{a.userName ?? '監査役（自動）'}</td>
              <td className="px-3 py-2 text-xs text-slate-600">{a.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
