'use client';

// 社員一覧（部署ごとにグループ表示）。並び順はサーバー（listPeople）で「部署→氏名」に固定されており、
// ここでは絞り込み・検索だけを行う。成果による並べ替え（ランキング）は作らない。
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, ChevronRight, Database, Hourglass, Search, UserRound } from 'lucide-react';
import { inputCls, EmptyState, Notice } from '@/components/ui';
import type { PersonSummary } from '@/lib/pro/people';

interface Props {
  people: PersonSummary[];
  today: string;
  teams: { code: string; name: string }[];
  taskSource: 'kintone' | 'local';
  taskNotice: string | null;
  companyWide: boolean;
  scopedTeamName: string | null;
  /** 管理職以上（機密欄を出してよい）。現時点で機密欄は無いが、追加時はこのフラグで出し分ける（サーバー側で既に落としてある前提） */
  canSeeConfidential: boolean;
}

const NONE = '__none__';

function fmtDue(due: string): string {
  const [, m, d] = due.split('-').map(Number);
  return `${m}/${d}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** 仕事量の判定（タスク管理のカンバンと同じ基準）: 期限超過あり=🔴 / 8件以上=🟡 / 3件以下=🟢 */
function loadOf(open: number, overdue: number): { label: string; cls: string } {
  if (overdue > 0) return { label: '期限超過', cls: 'bg-red-50 text-red-700 ring-red-200' };
  if (open >= 8) return { label: '多め', cls: 'bg-amber-50 text-amber-800 ring-amber-200' };
  if (open <= 3) return { label: '余裕あり', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  return { label: '通常', cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
}

function Count({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'red' | 'amber' }) {
  const cls =
    value === 0
      ? 'text-slate-400'
      : tone === 'red'
        ? 'text-red-700'
        : tone === 'amber'
          ? 'text-amber-800'
          : 'text-slate-800';
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`tabular text-base font-bold leading-tight ${cls}`}>{value}</div>
    </div>
  );
}

function NextDue({ due, today }: { due: string | null; today: string }) {
  if (!due) return <span className="text-[11px] text-slate-400">次の期限: なし</span>;
  const diff = daysBetween(today, due);
  let cls = 'bg-slate-100 text-slate-600';
  let label = `次の期限 ${fmtDue(due)}`;
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
  return (
    <span className={`tabular inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      <CalendarClock size={11} aria-hidden />
      {label}
    </span>
  );
}

function PersonCard({ p, today }: { p: PersonSummary; today: string }) {
  const load = loadOf(p.work.open, p.work.overdue);
  return (
    <Link
      href={`/pro/people/${p.id}`}
      className="group block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-bold text-slate-900">{p.name}</span>
            {p.isSelf && <span className="text-[10px] text-slate-400">（自分）</span>}
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-800">{p.levelJa}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-600">{p.title ?? <span className="text-slate-400">役職・担当業務 未設定</span>}</div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-600" aria-hidden />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${load.cls}`}>
          {p.work.overdue > 0 && <AlertTriangle size={11} aria-hidden />}
          {load.label}
        </span>
        <NextDue due={p.work.nextDue} today={today} />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3">
        <Count label="未完了" value={p.work.open} tone="neutral" />
        <Count label="期限超過" value={p.work.overdue} tone="red" />
        <Count label="確認待ち" value={p.work.waiting} tone="amber" />
        <Count label="完了/30日" value={p.work.done30d} tone="neutral" />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>
          Kintone: {p.kintoneName ? <span className="text-slate-700">{p.kintoneName}</span> : <span className="text-amber-700">未設定（氏名で照合）</span>}
        </span>
        {p.latestReport && (
          <span className="truncate">
            最新報告: {p.latestReport.title}（{fmtDue(p.latestReport.periodTo)}）
          </span>
        )}
      </div>
      {/* 機密欄（給与・人事評価など）を追加する場合: canSeeConfidential が true のときだけ描画する。
          値はサーバーの redactConfidential() で管理職未満には null になっている前提（UI非表示だけにしない） */}
    </Link>
  );
}

export default function PeopleDirectory({ people, today, teams, taskSource, taskNotice, companyWide, scopedTeamName }: Props) {
  const [team, setTeam] = useState<string>('all');
  const [q, setQ] = useState('');

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return people.filter((p) => {
      if (team !== 'all') {
        if (team === NONE ? p.teamCode != null : p.teamCode !== team) return false;
      }
      if (kw && !`${p.name} ${p.title ?? ''} ${p.kintoneName ?? ''} ${p.skills.join(' ')} ${p.teamName} ${p.levelJa}`.toLowerCase().includes(kw))
        return false;
      return true;
    });
  }, [people, team, q]);

  // 部署ごとにグループ化（people は既に部署→氏名順）
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; members: PersonSummary[] }>();
    for (const p of visible) {
      const key = p.teamCode ?? NONE;
      const g = map.get(key) ?? { name: p.teamName, members: [] };
      g.members.push(p);
      map.set(key, g);
    }
    return [...map.entries()];
  }, [visible]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (a, p) => ({ open: a.open + p.work.open, overdue: a.overdue + p.work.overdue, waiting: a.waiting + p.work.waiting }),
        { open: 0, overdue: 0, waiting: 0 },
      ),
    [visible],
  );

  const presentTeams = new Set(people.map((p) => p.teamCode ?? NONE));

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">社員・組織</h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              所属・役職・仕事の状態（タスク管理から自動集計）。並びは部署→氏名で、成果の順位付けはしません。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
              <Database size={11} aria-hidden />
              タスク: {taskSource === 'kintone' ? 'Kintone接続' : 'ローカル（未接続）'}
            </span>
            <span className="tabular">
              未完了 {totals.open} / 期限超過 <span className={totals.overdue ? 'font-semibold text-red-700' : ''}>{totals.overdue}</span> / 確認待ち{' '}
              <span className={totals.waiting ? 'font-semibold text-amber-800' : ''}>{totals.waiting}</span>
            </span>
          </div>
        </div>

        {!companyWide && (
          <div className="mt-3">
            <Notice tone="info">
              一般社員は自分と自チーム（{scopedTeamName ?? '未設定'}）のみ表示されます。他部署を見るにはリーダー以上の権限が必要です。
            </Notice>
          </div>
        )}
        {taskNotice && (
          <div className="mt-3">
            <Notice tone="warn">{taskNotice}</Notice>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative block w-full sm:w-64">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              className={`${inputCls} pl-8`}
              placeholder="氏名・役職・スキルで検索"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="検索"
            />
          </label>
          <select className={`${inputCls} w-auto`} value={team} onChange={(e) => setTeam(e.target.value)} aria-label="部署で絞り込み">
            <option value="all">すべての部署</option>
            {teams
              .filter((t) => presentTeams.has(t.code))
              .map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            {presentTeams.has(NONE) && <option value={NONE}>未設定</option>}
          </select>
          <span className="text-xs text-slate-500">{visible.length}人</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="該当する社員がいません" body="検索条件を変えるか、PRO設定で所属・Kintone担当者名を登録してください。" />
      ) : (
        groups.map(([key, g]) => (
          <section key={key} aria-label={g.name}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <UserRound size={14} className="text-slate-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-700">{g.name}</h2>
              <span className="text-xs text-slate-400">{g.members.length}人</span>
              {g.members.some((m) => m.work.waiting > 0) && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-800">
                  <Hourglass size={11} aria-hidden />
                  確認待ちあり
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.members.map((p) => (
                <PersonCard key={p.id} p={p} today={today} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
