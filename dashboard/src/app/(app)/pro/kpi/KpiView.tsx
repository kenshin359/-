'use client';

// KPI の画面（一覧・詳細）。判定は色の点だけで表し、数字は必ず出典付き（未取得は「未取得」と書く）。
import { useActionState, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Settings2 } from 'lucide-react';
import { btn, EmptyState, Field, inputCls, Notice, SlideOver } from '@/components/ui';
import type { TaskOptions } from '@/lib/tasks';
import { IMPACTS, PRIORITIES } from '@/lib/tasks-constants';
import { TEAM_DEFS } from '@/lib/pro/teams';
import { formatKpiValue, JUDGMENT_JA, type Judgment, type KpiDetail, type KpiPoint, type KpiSummary } from '@/lib/pro/kpi';
import { priorityLabel } from '@/lib/pro/tasks2';
import { addKpiValueAction, createImprovementTaskAction, upsertKpiAction, type ActionResult } from './actions';

const DOT: Record<Judgment, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
  none: 'bg-slate-300',
  na: 'bg-slate-200 ring-1 ring-inset ring-slate-400',
};

function JudgmentDot({ j, label = true }: { j: Judgment; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[j]}`} aria-hidden />
      {label && JUDGMENT_JA[j]}
    </span>
  );
}

function teamName(code: string | null): string {
  return code ? (TEAM_DEFS.find((t) => t.code === code)?.name ?? code) : '全社';
}

function thresholdText(k: KpiSummary): string {
  const f = (v: number | null) => (v == null ? null : formatKpiValue(v, k.unit));
  const parts: string[] = [];
  if (k.targetValue != null) parts.push(`目標 ${f(k.targetValue)}`);
  if (k.direction === 'down') {
    if (k.warnThreshold != null) parts.push(`${f(k.warnThreshold)} 超で注意`);
    if (k.dangerThreshold != null) parts.push(`${f(k.dangerThreshold)} 超で危険`);
  } else {
    if (k.warnThreshold != null) parts.push(`${f(k.warnThreshold)} 未満で注意`);
    if (k.dangerThreshold != null) parts.push(`${f(k.dangerThreshold)} 未満で危険`);
  }
  return parts.length ? parts.join('・') : '基準未設定';
}

/** 素の SVG 折れ線（ライブラリ不使用）。点が1つなら点だけ描く */
export function Sparkline({ points, width = 160, height = 40, showAxis = false }: { points: KpiPoint[]; width?: number; height?: number; showAxis?: boolean }) {
  if (!points.length) return <div className="flex h-10 items-center text-[11px] text-slate-400">値なし</div>;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = 3;
  const span = max - min || 1;
  const x = (i: number) => (points.length === 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - pad * 2));
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`推移 ${points.length}点、最新 ${last.value}`} className="overflow-visible">
      {showAxis && <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="#e2e8f0" strokeWidth={1} />}
      {points.length > 1 && <path d={d} fill="none" stroke="#1e3a8a" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={2.5} fill="#1e3a8a" />
    </svg>
  );
}

// ---------- 一覧 ----------
export function KpiList({ kpis, canManage }: { kpis: KpiSummary[]; canManage: boolean }) {
  const [editing, setEditing] = useState<KpiSummary | null | 'new'>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  const counts = { red: 0, yellow: 0, green: 0, na: 0 };
  for (const k of kpis) {
    if (k.judgment === 'red') counts.red++;
    else if (k.judgment === 'yellow') counts.yellow++;
    else if (k.judgment === 'green') counts.green++;
    else counts.na++;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">KPI</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            判定基準は現場の数値（docs/business.md §6）。危険 <b className="tabular text-red-700">{counts.red}</b>・注意{' '}
            <b className="tabular text-amber-800">{counts.yellow}</b>・正常 <b className="tabular text-emerald-700">{counts.green}</b>・未取得/基準なし{' '}
            <b className="tabular">{counts.na}</b>
          </p>
        </div>
        {canManage && (
          <button type="button" onClick={() => setEditing('new')} className={btn.primary}>
            <Plus size={14} aria-hidden />
            KPIを追加
          </button>
        )}
      </header>
      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      {kpis.length === 0 ? (
        <EmptyState title="KPIがありません" body="管理職以上が「KPIを追加」から定義してください。" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map((k) => (
            <li key={k.code} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/pro/kpi/${k.code}`} className="text-sm font-bold text-slate-900 hover:underline">
                    {k.name}
                  </Link>
                  <p className="truncate text-[11px] text-slate-500">
                    {teamName(k.teamCode)}・<code>{k.code}</code>
                  </p>
                </div>
                <JudgmentDot j={k.judgment} />
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className={`tabular text-2xl font-bold ${k.latest ? 'text-slate-900' : 'text-slate-400'}`}>{formatKpiValue(k.latest?.value, k.unit)}</p>
                  <p className="tabular text-[11px] text-slate-500">
                    {k.latest ? `${k.latest.date} 時点` : '値が記録されていません'}
                    {k.delta != null && (
                      <span className={`ml-2 ${(k.direction === 'up' ? k.delta >= 0 : k.delta <= 0) ? 'text-emerald-700' : 'text-red-700'}`}>
                        前回比 {k.delta > 0 ? '+' : ''}
                        {formatKpiValue(k.delta, k.unit)}
                      </span>
                    )}
                  </p>
                </div>
                <Sparkline points={k.series} width={120} height={36} />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">{thresholdText(k)}</p>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">改善タスク（未完了） <b className="tabular text-slate-800">{k.linkedOpen}</b></span>
                <div className="flex gap-1">
                  {canManage && (
                    <button type="button" onClick={() => setEditing(k)} className={btn.ghost} aria-label={`${k.name} の定義を編集`}>
                      <Settings2 size={13} aria-hidden />
                    </button>
                  )}
                  <Link href={`/pro/kpi/${k.code}`} className={btn.ghost}>
                    詳細
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SlideOver open={editing != null} title={editing === 'new' ? 'KPIを追加' : 'KPIの定義を編集'} onClose={() => setEditing(null)}>
        {editing != null && (
          <KpiForm
            kpi={editing === 'new' ? null : editing}
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

function KpiForm({ kpi, onDone }: { kpi: KpiSummary | null; onDone: (r: ActionResult) => void }) {
  const [result, formAction, pending] = useActionState(upsertKpiAction, null);
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="コード" required hint="英小文字・数字・_（例: suitcase_cpa）。作成後は変更不可">
          <input name="code" required defaultValue={kpi?.code ?? ''} readOnly={!!kpi} pattern="[a-z][a-z0-9_]*" className={inputCls} />
        </Field>
        <Field label="KPI名" required>
          <input name="name" required maxLength={60} defaultValue={kpi?.name ?? ''} className={inputCls} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="単位" required>
          <select name="unit" defaultValue={kpi?.unit ?? '円'} className={inputCls}>
            {['円', '%', '件', '倍', '個'].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label="方向" required hint="up=大きいほど良い / down=小さいほど良い">
          <select name="direction" defaultValue={kpi?.direction ?? 'up'} className={inputCls}>
            <option value="up">up（大きいほど良い）</option>
            <option value="down">down（小さいほど良い）</option>
          </select>
        </Field>
        <Field label="部署">
          <select name="teamCode" defaultValue={kpi?.teamCode ?? ''} className={inputCls}>
            <option value="">全社</option>
            {TEAM_DEFS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="目標値">
          <input name="targetValue" inputMode="decimal" defaultValue={kpi?.targetValue ?? ''} className={`${inputCls} tabular`} />
        </Field>
        <Field label="注意の閾値" hint="downは超えたら / upは下回ったら">
          <input name="warnThreshold" inputMode="decimal" defaultValue={kpi?.warnThreshold ?? ''} className={`${inputCls} tabular`} />
        </Field>
        <Field label="危険の閾値">
          <input name="dangerThreshold" inputMode="decimal" defaultValue={kpi?.dangerThreshold ?? ''} className={`${inputCls} tabular`} />
        </Field>
      </div>
      <Field label="補足（定義・出典）" hint="何を割って何を出すか、出典のファイル名を書く">
        <textarea name="note" rows={3} maxLength={400} defaultValue={kpi?.note ?? ''} className={inputCls} />
      </Field>
      {kpi && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="active" value="on" defaultChecked={kpi.active} className="accent-blue-900" />
          有効（外すと一覧に出なくなります）
          <input type="hidden" name="active" value="off" />
        </label>
      )}
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}

// ---------- 詳細 ----------
export function KpiDetailView({
  kpi,
  options,
  canRecord,
  canManage,
  canCreateTask,
  defaultAssignee,
}: {
  kpi: KpiDetail;
  options: TaskOptions;
  canRecord: boolean;
  canManage: boolean;
  canCreateTask: boolean;
  defaultAssignee: string;
}) {
  const [range, setRange] = useState<30 | 90>(30);
  const [newTask, setNewTask] = useState(false);
  const [editDef, setEditDef] = useState(false);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);
  const points = range === 30 ? kpi.series : kpi.series90;
  const recent = [...kpi.series90].reverse().slice(0, 10);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/pro/kpi" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
          <ArrowLeft size={13} aria-hidden />
          KPI一覧
        </Link>
      </div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            {kpi.name}
            <JudgmentDot j={kpi.judgment} />
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {teamName(kpi.teamCode)}・<code>{kpi.code}</code>・{thresholdText(kpi)}
          </p>
          {kpi.note && <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500">{kpi.note}</p>}
        </div>
        <div className="flex gap-2">
          {canManage && (
            <button type="button" onClick={() => setEditDef(true)} className={btn.secondary}>
              <Settings2 size={14} aria-hidden />
              定義を編集
            </button>
          )}
          {canCreateTask && (
            <button type="button" onClick={() => setNewTask(true)} className={btn.primary}>
              <Plus size={14} aria-hidden />
              改善タスクを作る
            </button>
          )}
        </div>
      </header>
      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl bg-white p-4 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className={`tabular text-3xl font-bold ${kpi.latest ? 'text-slate-900' : 'text-slate-400'}`}>{formatKpiValue(kpi.latest?.value, kpi.unit)}</p>
              <p className="tabular text-[11px] text-slate-500">{kpi.latest ? `${kpi.latest.date} 時点${kpi.latest.note ? `・${kpi.latest.note}` : ''}` : '値が記録されていません（推測で埋めません）'}</p>
            </div>
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="期間">
              {([30, 90] as const).map((r) => (
                <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={`rounded px-2.5 py-1 text-xs font-medium ${range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {r}日
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <Sparkline points={points} width={640} height={140} showAxis />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {points.length} 点 / 全 {kpi.valueCount} 点{points.length > 0 && `・${points[0].date} 〜 ${points[points.length - 1].date}`}
          </p>
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">値を記録</h2>
          {canRecord ? (
            <ValueForm code={kpi.code} unit={kpi.unit} onDone={(r) => { setFlash(r); if (r.ok) router.refresh(); }} />
          ) : (
            <p className="mt-2 text-xs text-slate-500">値の記録はリーダー以上（書込権限あり）が行います。</p>
          )}
          {recent.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 text-xs">
              {recent.map((p) => (
                <li key={p.date} className="flex items-center justify-between py-1">
                  <span className="tabular text-slate-500">{p.date}</span>
                  <span className="tabular font-medium text-slate-800">{formatKpiValue(p.value, kpi.unit)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl bg-white shadow-sm">
        <header className="border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-bold text-slate-900">
            改善タスク <span className="tabular text-slate-500">{kpi.tasks.length}</span>
          </h2>
          <p className="text-[11px] text-slate-500">完了したタスクは、作成時点の値と最新値を並べて効果を見ます（値が無い期間は「未取得」）。</p>
        </header>
        {kpi.tasks.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">このKPIに紐づくタスクはありません。「改善タスクを作る」から担当・期限・完了の定義を決めて登録してください。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">タスク</th>
                  <th className="px-2 py-2 text-left font-medium">担当</th>
                  <th className="px-2 py-2 text-left font-medium">優先度</th>
                  <th className="px-2 py-2 text-left font-medium">期限</th>
                  <th className="px-2 py-2 text-left font-medium">状態</th>
                  <th className="px-2 py-2 text-right font-medium">進捗</th>
                  <th className="px-2 py-2 text-right font-medium">作成時</th>
                  <th className="px-2 py-2 text-right font-medium">最新</th>
                  <th className="px-4 py-2 text-right font-medium">差</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {kpi.tasks.map(({ task: t, before, after, delta }) => {
                  const done = t.displayStatus === '完了';
                  const good = delta == null ? null : kpi.direction === 'up' ? delta > 0 : delta < 0;
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="max-w-[320px] px-4 py-2">
                        <Link href={`/pro/tasks?tab=list&status=${done ? '完了' : ''}&assignee=${encodeURIComponent(t.assignee)}`} className="line-clamp-2 font-medium text-slate-900 hover:underline">
                          {t.title}
                        </Link>
                        <p className="truncate text-[11px] text-slate-500">{t.doneDef}</p>
                      </td>
                      <td className="px-2 py-2 text-slate-700">{t.assignee}</td>
                      <td className="tabular px-2 py-2 text-slate-700">{priorityLabel(t.priority)}</td>
                      <td className="tabular px-2 py-2 text-slate-700">{t.due ?? '—'}</td>
                      <td className="px-2 py-2 text-slate-700">{t.displayStatus}</td>
                      <td className="tabular px-2 py-2 text-right text-slate-700">{done ? '100%' : `${t.progress}%`}</td>
                      <td className="tabular px-2 py-2 text-right text-slate-700">{done ? formatKpiValue(before, kpi.unit) : '—'}</td>
                      <td className="tabular px-2 py-2 text-right text-slate-700">{done ? formatKpiValue(after, kpi.unit) : '—'}</td>
                      <td className={`tabular px-4 py-2 text-right font-semibold ${good == null ? 'text-slate-400' : good ? 'text-emerald-700' : 'text-red-700'}`}>
                        {delta == null ? (done ? '未取得' : '—') : `${delta > 0 ? '+' : ''}${formatKpiValue(delta, kpi.unit)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SlideOver open={newTask} title={`改善タスクを作る — ${kpi.name}`} onClose={() => setNewTask(false)}>
        <ImprovementTaskForm
          kpi={kpi}
          options={options}
          defaultAssignee={defaultAssignee}
          onDone={(r) => {
            setFlash(r);
            if (r.ok) {
              setNewTask(false);
              router.refresh();
            }
          }}
        />
      </SlideOver>
      <SlideOver open={editDef} title="KPIの定義を編集" onClose={() => setEditDef(false)}>
        <KpiForm
          kpi={kpi}
          onDone={(r) => {
            setFlash(r);
            if (r.ok) {
              setEditDef(false);
              router.refresh();
            }
          }}
        />
      </SlideOver>
    </div>
  );
}

function ValueForm({ code, unit, onDone }: { code: string; unit: string; onDone: (r: ActionResult) => void }) {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addKpiValueAction(code, date, value, note);
          onDone(r);
          if (r.ok) {
            setValue('');
            setNote('');
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="日付" required>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={`${inputCls} tabular`} />
        </Field>
        <Field label={`値（${unit}）`} required>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required className={`${inputCls} tabular`} placeholder="例: 4200" />
        </Field>
      </div>
      <Field label="メモ" hint="出典（例: 広告費レポート 9/18）">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={inputCls} />
      </Field>
      <div className="flex justify-end">
        <button type="submit" disabled={pending || !value.trim()} className={btn.primary}>
          {pending ? '記録中…' : '記録'}
        </button>
      </div>
    </form>
  );
}

function ImprovementTaskForm({ kpi, options, defaultAssignee, onDone }: { kpi: KpiDetail; options: TaskOptions; defaultAssignee: string; onDone: (r: ActionResult) => void }) {
  const [result, formAction, pending] = useActionState(createImprovementTaskAction, null);
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  const defaultTeam = kpi.teamCode ? (TEAM_DEFS.find((t) => t.code === kpi.teamCode)?.kintoneLabels[0] ?? '') : '';
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="kpiCode" value={kpi.code} />
      <Notice tone="info">
        対象KPI: <b>{kpi.name}</b>（現在 {formatKpiValue(kpi.latest?.value, kpi.unit)}・{thresholdText(kpi)}）。完了後に前後比較が出ます。
      </Notice>
      <Field label="施策（タスク名）" required>
        <input name="title" required maxLength={120} className={inputCls} placeholder={`例: ${kpi.name}改善 — Meta広告の訴求をABテスト`} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="担当者" required>
          <select name="assignee" required defaultValue={options.members.includes(defaultAssignee) ? defaultAssignee : ''} className={inputCls}>
            <option value="">選択</option>
            {options.members.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="チーム" required>
          <select name="team" required defaultValue={options.teams.includes(defaultTeam) ? defaultTeam : ''} className={inputCls}>
            <option value="">選択</option>
            {options.teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="完了の定義（目標値）" required hint={`数字で。例: ${kpi.name} を ${kpi.targetValue != null ? formatKpiValue(kpi.targetValue, kpi.unit) : '目標値'} ${kpi.direction === 'down' ? '以下' : '以上'}に`}>
        <input name="doneDef" required maxLength={200} className={inputCls} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="期限" required>
          <input name="due" type="date" required className={`${inputCls} tabular`} />
        </Field>
        <Field label="優先度">
          <select name="priority" defaultValue="P2" className={inputCls}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="売上直結度">
          <select name="impact" defaultValue={IMPACTS[0]} className={inputCls}>
            {IMPACTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="柳井基準（撤退・判断ライン）" hint="例: 2週間で改善なければ施策を止める">
        <input name="yanai" maxLength={200} className={inputCls} />
      </Field>
      <Field label="施策の中身（備考）">
        <textarea name="memo" rows={3} maxLength={2000} className={inputCls} />
      </Field>
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? '登録中…' : '登録'}
        </button>
      </div>
    </form>
  );
}
