'use client';

// アラートセンターの一覧。🔴と🟡でグループ化し、対象へのリンク・解決・ミュートを1行で扱う。
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { BellOff, Check, ExternalLink } from 'lucide-react';
import { btn, EmptyState, Notice } from '@/components/ui';
import type { AlertItem } from '@/lib/pro/alerts';
import { muteAlertAction, resolveAlertAction, type ActionResult } from './actions';

interface Props {
  alerts: AlertItem[];
  canManage: boolean;
  scope: 'company' | 'team';
  kpiStatus: { status: 'ok'; appId: string } | { status: 'unavailable'; appId: string; reason: string };
  evalNotice: string | null;
}

const CODE_JA: Record<string, string> = {
  task_overdue: '期限超過',
  waiting_stale: '確認待ち滞留',
  no_assignee: '担当者未設定',
  stale_update: '長期未更新',
  task_concentration: 'タスク集中',
  sales_pace: '目標未達ペース',
  ad_ratio: '広告費率',
};

const MUTE_OPTIONS = [1, 3, 7, 14, 30];

function fmtSince(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function Row({
  a,
  canManage,
  busy,
  onResolve,
  onMute,
}: {
  a: AlertItem;
  canManage: boolean;
  busy: boolean;
  onResolve: (id: string) => void;
  onMute: (id: string, days: number) => void;
}) {
  const [days, setDays] = useState(3);
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{CODE_JA[a.code] ?? a.code}</span>
          {a.teamName && <span className="text-[10px] text-slate-500">{a.teamName}</span>}
          <span className="text-[10px] text-slate-400">初回 {fmtSince(a.firstSeenAt)}</span>
        </div>
        <Link href={a.href} className="mt-0.5 inline-flex max-w-full items-center gap-1 text-sm font-medium text-slate-800 hover:text-blue-900 hover:underline">
          <span className="truncate">{a.title}</span>
          <ExternalLink size={12} className="shrink-0 text-slate-400" aria-hidden />
        </Link>
        {a.detail && <p className="text-[11px] leading-snug text-slate-500">{a.detail}</p>}
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className={btn.secondary}
            disabled={busy}
            onClick={() => onResolve(a.id)}
            title="解決済みにする（条件が解消して再発したら再表示）"
          >
            <Check size={13} aria-hidden />
            解決
          </button>
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">ミュート日数</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-1.5 py-1.5 text-xs text-slate-700"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              disabled={busy}
            >
              {MUTE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}日
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={btn.ghost} disabled={busy} onClick={() => onMute(a.id, days)} title="指定日数ミュート">
            <BellOff size={13} aria-hidden />
            ミュート
          </button>
        </div>
      )}
    </li>
  );
}

export default function AlertCenter({ alerts, canManage, scope, kpiStatus, evalNotice }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  const visible = useMemo(() => alerts.filter((a) => !hidden.has(a.id)), [alerts, hidden]);
  const red = visible.filter((a) => a.level === 'red');
  const yellow = visible.filter((a) => a.level === 'yellow');

  const run = (id: string, fn: () => Promise<ActionResult>) => {
    startTransition(async () => {
      const r = await fn();
      setFlash(r);
      if (r.ok) setHidden((s) => new Set(s).add(id));
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">アラートセンター</h1>
          <p className="text-xs text-slate-500">
            🔴 {red.length}件 / 🟡 {yellow.length}件 {scope === 'team' ? '（自チーム分のみ）' : '（全社）'}
          </p>
        </div>
        <span className={`text-[11px] ${kpiStatus.status === 'ok' ? 'text-emerald-700' : 'text-slate-500'}`}>
          売上・広告費ルール: KPI報告({kpiStatus.appId}) {kpiStatus.status === 'ok' ? '接続中' : '未接続（タスク系のみ評価）'}
        </span>
      </div>

      {evalNotice && <Notice tone="error">{evalNotice}</Notice>}
      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      {visible.length === 0 ? (
        <EmptyState
          title="異常なし"
          body={
            kpiStatus.status === 'ok'
              ? '期限超過・確認待ち滞留・担当者未設定・長期未更新・タスク集中・目標未達ペース・広告費率のいずれも該当しません。'
              : 'タスク系のルールに該当はありません。売上・広告費のルールは Kintone KPI報告(30) 接続後に評価されます。'
          }
        />
      ) : (
        <>
          <Group title="🔴 今すぐ判断" tone="red" items={red} canManage={canManage} busy={pending} run={run} />
          <Group title="🟡 注意" tone="amber" items={yellow} canManage={canManage} busy={pending} run={run} />
        </>
      )}

      {!canManage && visible.length > 0 && (
        <p className="text-[11px] text-slate-500">解決・ミュートはリーダー以上が行えます。</p>
      )}
    </div>
  );
}

function Group({
  title,
  tone,
  items,
  canManage,
  busy,
  run,
}: {
  title: string;
  tone: 'red' | 'amber';
  items: AlertItem[];
  canManage: boolean;
  busy: boolean;
  run: (id: string, fn: () => Promise<ActionResult>) => void;
}) {
  if (items.length === 0) return null;
  const head = tone === 'red' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-sm">
      <h2 className={`border-b px-3 py-2 text-[13px] font-semibold ${head}`}>
        {title} <span className="tabular font-normal">({items.length})</span>
      </h2>
      <ul className="divide-y divide-slate-100">
        {items.map((a) => (
          <Row
            key={a.id}
            a={a}
            canManage={canManage}
            busy={busy}
            onResolve={(id) => run(id, () => resolveAlertAction(id))}
            onMute={(id, days) => run(id, () => muteAlertAction(id, days))}
          />
        ))}
      </ul>
    </section>
  );
}
