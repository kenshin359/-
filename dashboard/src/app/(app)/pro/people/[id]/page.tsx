// PRO ⑨ 社員詳細: 所属・役職・担当業務・スキル・権限、現在/完了/期限超過タスク、担当KPI、最近の報告・メモ。
// 閲覧可否（一般社員は本人と自チームのみ）は getPerson がサーバー側で判定する。
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CalendarClock, Database, Settings2 } from 'lucide-react';
import { EmptyState, Notice } from '@/components/ui';
import { requireActor } from '@/lib/rbac';
import { ROLE_JA } from '@/lib/users';
import { getPerson } from '@/lib/pro/people';
import type { TaskItem } from '@/lib/tasks';
import { EditProfileButton } from '../ProfileForm';

export const dynamic = 'force-dynamic';

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

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const PRIORITY_CLS: Record<string, string> = {
  P1: 'bg-red-600 text-white',
  P2: 'bg-blue-900 text-white',
  P3: 'bg-slate-200 text-slate-700',
  P4: 'bg-slate-100 text-slate-500',
};

const STATUS_CLS: Record<string, string> = {
  未着手: 'bg-slate-100 text-slate-600',
  進行中: 'bg-blue-50 text-blue-800',
  確認待ち: 'bg-amber-50 text-amber-800',
  完了: 'bg-emerald-50 text-emerald-700',
};

const REPORT_TYPE_JA: Record<string, string> = { daily: '日報', weekly: '週報', interim: '中間報告' };
const REPORT_STATUS_JA: Record<string, string> = { draft: '下書き', submitted: '提出済', reviewed: '確認済' };

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

function TaskRow({ t, today }: { t: TaskItem; today: string }) {
  const done = t.status === '完了';
  return (
    <li className="flex items-start gap-2 py-2">
      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_CLS[t.priority] ?? PRIORITY_CLS.P3}`}>{t.priority}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-800">{t.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          {t.team && <span>{t.team}</span>}
          <span className={`rounded px-1.5 py-0.5 ${STATUS_CLS[t.status] ?? STATUS_CLS.未着手}`}>{t.status}</span>
          <DueChip due={t.due} today={today} done={done} />
          {done && t.updatedAt && <span>完了 {fmtDateTime(t.updatedAt)}</span>}
          {t.doneDef && <span className="truncate">完了の定義: {t.doneDef}</span>}
        </div>
      </div>
    </li>
  );
}

function Card({ title, count, children, tone }: { title: string; count?: number; children: React.ReactNode; tone?: 'red' }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        {tone === 'red' && <AlertTriangle size={14} className="text-red-600" aria-hidden />}
        {title}
        {count !== undefined && <span className={`tabular text-xs font-normal ${tone === 'red' && count > 0 ? 'text-red-700' : 'text-slate-400'}`}>{count}件</span>}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Dl({ items }: { items: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map((it) => (
        <div key={it.k} className="contents">
          <dt className="text-xs text-slate-500">{it.k}</dt>
          <dd className="min-w-0 text-slate-800">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const p = await getPerson(id, actor);

  if (!p) {
    return (
      <div className="space-y-4">
        <Link href="/pro/people" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
          <ArrowLeft size={12} aria-hidden />
          社員・組織へ戻る
        </Link>
        <EmptyState
          title="この社員は表示できません"
          body="存在しないか、閲覧権限がありません（一般社員は本人と同じ部署のメンバーのみ閲覧できます）。"
        />
      </div>
    );
  }

  const unset = <span className="text-slate-400">未設定</span>;

  return (
    <div className="space-y-4">
      <Link href="/pro/people" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
        <ArrowLeft size={12} aria-hidden />
        社員・組織へ戻る
      </Link>

      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">{p.name}</h1>
              {p.isSelf && <span className="text-[11px] text-slate-400">（自分）</span>}
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800">{p.levelJa}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{p.teamName}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{p.title ?? <span className="text-slate-400">役職・担当業務 未設定</span>}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {p.canEdit && (
              <EditProfileButton
                userId={p.id}
                userName={p.name}
                initial={{ title: p.title ?? '', kintoneName: p.kintoneName ?? '', skills: p.skills.join(', '), lineUserId: p.lineUserId ?? '' }}
                members={p.memberOptions}
              />
            )}
            {p.canAssign && (
              <Link href="/pro/settings#assign" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                <Settings2 size={12} aria-hidden />
                権限・所属を変更
              </Link>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Dl
            items={[
              { k: '所属', v: p.teamName },
              { k: '役職・担当業務', v: p.title ?? unset },
              { k: '権限', v: `${p.levelJa}（ログインロール: ${ROLE_JA[p.role] ?? p.role}）` },
              { k: 'メール', v: <span className="break-all text-xs">{p.email}</span> },
            ]}
          />
          <Dl
            items={[
              {
                k: 'Kintone担当者名',
                v: p.kintoneName ?? <span className="text-amber-700">未設定（氏名の前方一致で照合中）</span>,
              },
              {
                k: 'スキル',
                v: p.skills.length ? (
                  <span className="flex flex-wrap gap-1">
                    {p.skills.map((s) => (
                      <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                        {s}
                      </span>
                    ))}
                  </span>
                ) : (
                  unset
                ),
              },
              ...(p.canEdit ? [{ k: 'LINE userId', v: p.lineUserId ? <span className="font-mono text-xs">{p.lineUserId}</span> : unset }] : []),
              { k: '登録日', v: new Date(p.createdAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) },
            ]}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-5">
          {[
            { k: '未完了', v: p.work.open, cls: '' },
            { k: 'うちP1', v: p.work.p1Open, cls: p.work.p1Open ? 'text-red-700' : '' },
            { k: '期限超過', v: p.work.overdue, cls: p.work.overdue ? 'text-red-700' : '' },
            { k: '確認待ち', v: p.work.waiting, cls: p.work.waiting ? 'text-amber-800' : '' },
            { k: '完了（30日）', v: p.work.done30d, cls: '' },
          ].map((s) => (
            <div key={s.k}>
              <div className="text-[10px] text-slate-500">{s.k}</div>
              <div className={`tabular text-lg font-bold ${s.v === 0 ? 'text-slate-400' : s.cls || 'text-slate-800'}`}>{s.v}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
            <Database size={11} aria-hidden />
            タスク: {p.taskSource === 'kintone' ? 'Kintone接続' : 'ローカル（未接続）'}
          </span>
          {p.work.nextDue && <span>次の期限: {fmtDue(p.work.nextDue)}</span>}
        </div>
        {p.taskNotice && (
          <div className="mt-3">
            <Notice tone="warn">{p.taskNotice}</Notice>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="現在のタスク" count={p.openTasks.length}>
          {p.openTasks.length === 0 ? (
            <p className="text-xs text-slate-500">未完了のタスクはありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {p.openTasks.map((t) => (
                <TaskRow key={t.id} t={t} today={p.today} />
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="期限超過" count={p.overdueTasks.length} tone="red">
            {p.overdueTasks.length === 0 ? (
              <p className="text-xs text-emerald-700">期限超過はありません。</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {p.overdueTasks.map((t) => (
                  <TaskRow key={t.id} t={t} today={p.today} />
                ))}
              </ul>
            )}
          </Card>
          <Card title="完了したタスク（直近30日）" count={p.doneTasks.length}>
            {p.doneTasks.length === 0 ? (
              <p className="text-xs text-slate-500">直近30日に完了したタスクはありません。</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {p.doneTasks.map((t) => (
                  <TaskRow key={t.id} t={t} today={p.today} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="担当KPI" count={p.kpis.length}>
          {p.kpis.length === 0 ? (
            <p className="text-xs text-slate-500">未設定（KPIの担当者が割り当てられていません）</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {p.kpis.map((k) => (
                <li key={k.code} className="py-2">
                  <Link href={`/pro/kpi/${k.code}`} className="text-sm font-medium text-slate-800 hover:text-blue-800">
                    {k.name}
                  </Link>
                  <div className="tabular mt-0.5 text-[11px] text-slate-500">
                    最新: {k.latestValue == null ? '未取得' : `${k.latestValue.toLocaleString('ja-JP')}${k.unit}`}
                    {k.latestDate && `（${k.latestDate}）`} / 目標: {k.targetValue == null ? '未設定' : `${k.targetValue.toLocaleString('ja-JP')}${k.unit}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="最近の報告" count={p.reports.length}>
          {p.reports.length === 0 ? (
            <p className="text-xs text-slate-500">報告はまだありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {p.reports.map((r) => (
                <li key={r.id} className="py-2">
                  <Link href={`/pro/reports/${r.id}`} className="text-sm text-slate-800 hover:text-blue-800">
                    {r.title}
                  </Link>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {REPORT_TYPE_JA[r.type] ?? r.type} / {r.periodFrom}〜{r.periodTo} / {REPORT_STATUS_JA[r.status] ?? r.status}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="最近のメモ" count={p.notes.length}>
          {p.notes.length === 0 ? (
            <p className="text-xs text-slate-500">メモはまだありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {p.notes.map((n) => (
                <li key={n.id} className="py-2">
                  <p className="whitespace-pre-wrap text-sm text-slate-800">{n.body}</p>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {fmtDateTime(n.createdAt)}
                    {n.entityType && ` / ${n.entityType}${n.entityId ? `:${n.entityId}` : ''}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
