'use client';

// 報告の画面。一覧（絞り込み）・詳細パネル・作成フォーム・リーダー向け中間報告の自動生成（テンプレート）。
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileText, Plus, Wand2 } from 'lucide-react';
import { btn, EmptyState, Field, inputCls, Notice, SlideOver } from '@/components/ui';
import { TEAM_DEFS } from '@/lib/pro/teams';
import { BODY_LABELS, REPORT_STATUS_JA, REPORT_TYPE_JA, REPORT_TYPES, type ReportBodyType, type ReportItem, type ReportType } from '@/lib/pro/reports';
import { createReportAction, generateInterimAction, reviewAction, type ActionResult } from './actions';

interface Filter {
  teamCode: string;
  type: string;
  from: string;
  to: string;
}

interface FormDefaults {
  id?: string;
  type: ReportType;
  teamCode: string;
  periodFrom: string;
  periodTo: string;
  title: string;
  body: ReportBodyType;
}

interface Props {
  reports: ReportItem[];
  actor: { id: string; name: string; teamCode: string | null; isAdmin: boolean };
  canWrite: boolean;
  canReview: boolean;
  canGenerate: boolean;
  openNew: boolean;
  openId: string | null;
  initialFilter: Filter;
}

const EMPTY_BODY: ReportBodyType = { numbers: '', learned: '', next: '', issues: '', requests: '' };

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function md(key: string): string {
  return key.slice(5).replace('-', '/');
}
function teamName(code: string | null): string {
  return code ? (TEAM_DEFS.find((t) => t.code === code)?.name ?? code) : '全社';
}

function defaultsFor(type: ReportType, teamCode: string, authorName: string): FormDefaults {
  const today = todayJst();
  const from = type === 'daily' ? today : addDays(today, -6);
  const tn = teamName(teamCode || null);
  const title = type === 'daily' ? `${tn} 日報 ${md(today)}（${authorName}）` : type === 'weekly' ? `${tn} 週報 ${md(from)}〜${md(today)}` : `${tn} 中間報告 ${md(from)}〜${md(today)}`;
  return { type, teamCode, periodFrom: from, periodTo: today, title, body: EMPTY_BODY };
}

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-50 text-blue-900',
  reviewed: 'bg-emerald-50 text-emerald-700',
};

export default function ReportsView(props: Props) {
  const { reports, actor, canWrite, canReview, canGenerate } = props;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(props.initialFilter);
  const [form, setForm] = useState<FormDefaults | null>(props.openNew ? defaultsFor('daily', actor.teamCode ?? '', actor.name) : null);
  const [openId, setOpenId] = useState<string | null>(props.openId);
  const [genTeam, setGenTeam] = useState(actor.teamCode ?? TEAM_DEFS[0]?.code ?? '');
  const [genNotice, setGenNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(id);
  }, [flash]);

  const visible = useMemo(
    () =>
      reports.filter((r) => {
        if (filter.teamCode && r.teamCode !== filter.teamCode) return false;
        if (filter.type && r.type !== filter.type) return false;
        if (filter.from && r.periodTo < filter.from) return false;
        if (filter.to && r.periodFrom > filter.to) return false;
        return true;
      }),
    [reports, filter],
  );
  const current = openId ? (reports.find((r) => r.id === openId) ?? null) : null;

  const generate = () => {
    start(async () => {
      const r = await generateInterimAction(genTeam);
      if (!r.ok) {
        setFlash(r);
        return;
      }
      setGenNotice(r.notice);
      setForm({ type: 'interim', teamCode: r.draft.teamCode, periodFrom: r.draft.periodFrom, periodTo: r.draft.periodTo, title: r.draft.title, body: r.draft.body });
    });
  };

  const sel = `${inputCls.replace("w-full", "")} w-full sm:w-auto sm:min-w-[11rem]`;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">報告</h1>
          <p className="mt-0.5 text-xs text-slate-500">日報・週報・中間報告。朝礼と同じ順（数字→学び→次→課題→依頼）で書く。数字が無ければ「未取得」と書く。</p>
        </div>
        {canWrite && (
          <button type="button" onClick={() => setForm(defaultsFor('daily', actor.teamCode ?? '', actor.name))} className={btn.primary}>
            <Plus size={14} aria-hidden />
            報告を書く
          </button>
        )}
      </header>
      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}

      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select value={filter.teamCode} onChange={(e) => setFilter({ ...filter, teamCode: e.target.value })} className={sel} aria-label="部署">
            <option value="">すべての部署</option>
            {TEAM_DEFS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} className={sel} aria-label="種類">
            <option value="">すべての種類</option>
            {REPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {REPORT_TYPE_JA[t]}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1 text-xs text-slate-600">
            期間
            <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} className={`${sel} tabular`} aria-label="期間の開始" />
            〜
            <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} className={`${sel} tabular`} aria-label="期間の終了" />
          </label>
          <span className="tabular text-[11px] text-slate-500">
            {visible.length}/{reports.length}件
          </span>
          {canGenerate && (
            <div className="ml-auto flex items-center gap-1.5">
              <select value={genTeam} onChange={(e) => setGenTeam(e.target.value)} className={sel} aria-label="中間報告を生成する部署">
                {TEAM_DEFS.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={generate} disabled={pending} className={btn.secondary} title="タスク状況とアラートから下書きを組み立てます（編集してから提出）">
                <Wand2 size={14} aria-hidden />
                {pending ? '生成中…' : 'リーダー向け中間報告を生成'}
              </button>
            </div>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="報告はまだありません" body="「報告を書く」から日報・週報を残すと、部署・期間で見返せます。" action={canWrite ? <button type="button" onClick={() => setForm(defaultsFor('daily', actor.teamCode ?? '', actor.name))} className={btn.primary}>報告を書く</button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">期間</th>
                <th className="px-2 py-2 text-left font-medium">種類</th>
                <th className="px-2 py-2 text-left font-medium">部署</th>
                <th className="px-2 py-2 text-left font-medium">タイトル</th>
                <th className="px-2 py-2 text-left font-medium">作成者</th>
                <th className="px-2 py-2 text-left font-medium">状態</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="tabular whitespace-nowrap px-4 py-2 text-slate-700">{r.periodFrom === r.periodTo ? r.periodFrom : `${r.periodFrom} 〜 ${r.periodTo}`}</td>
                  <td className="px-2 py-2 text-slate-700">{REPORT_TYPE_JA[r.type]}</td>
                  <td className="px-2 py-2 text-slate-700">{r.teamName}</td>
                  <td className="max-w-[320px] px-2 py-2">
                    <button type="button" onClick={() => setOpenId(r.id)} className="line-clamp-2 text-left font-medium text-slate-900 hover:underline">
                      {r.title}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-slate-700">{r.authorName}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[r.status] ?? 'bg-slate-100 text-slate-600'}`}>{REPORT_STATUS_JA[r.status] ?? r.status}</span>
                    {r.reviewedByName && <span className="ml-1.5 text-[11px] text-slate-500">{r.reviewedByName}</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" onClick={() => setOpenId(r.id)} className={btn.ghost}>
                      <FileText size={13} aria-hidden />
                      開く
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlideOver open={current != null} title={current?.title ?? ''} onClose={() => setOpenId(null)}>
        {current && (
          <ReportDetail
            r={current}
            canReview={canReview && current.status === 'submitted'}
            canEdit={canWrite && current.status !== 'reviewed' && (current.authorUserId === actor.id || actor.isAdmin)}
            onEdit={() => {
              setOpenId(null);
              setForm({ id: current.id, type: current.type, teamCode: current.teamCode ?? '', periodFrom: current.periodFrom, periodTo: current.periodTo, title: current.title, body: current.body });
            }}
            onReview={() =>
              start(async () => {
                const r = await reviewAction(current.id);
                setFlash(r);
                if (r.ok) {
                  setOpenId(null);
                  router.refresh();
                }
              })
            }
          />
        )}
      </SlideOver>

      <SlideOver open={form != null} title={form?.id ? '報告を編集' : form?.type === 'interim' ? '中間報告（下書き・編集してから提出）' : '報告を書く'} onClose={() => { setForm(null); setGenNotice(null); }}>
        {form && (
          <ReportForm
            key={`${form.id ?? 'new'}-${form.type}-${form.title}`}
            defaults={form}
            authorName={actor.name}
            notice={genNotice}
            onDone={(r) => {
              setFlash(r);
              if (r.ok) {
                setForm(null);
                setGenNotice(null);
                router.refresh();
              }
            }}
          />
        )}
      </SlideOver>
    </div>
  );
}

function ReportDetail({ r, canReview, canEdit, onEdit, onReview }: { r: ReportItem; canReview: boolean; canEdit: boolean; onEdit: () => void; onReview: () => void }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">種類</dt>
        <dd className="text-slate-800">{REPORT_TYPE_JA[r.type]}</dd>
        <dt className="text-slate-500">部署</dt>
        <dd className="text-slate-800">{r.teamName}</dd>
        <dt className="text-slate-500">期間</dt>
        <dd className="tabular text-slate-800">{r.periodFrom === r.periodTo ? r.periodFrom : `${r.periodFrom} 〜 ${r.periodTo}`}</dd>
        <dt className="text-slate-500">作成者</dt>
        <dd className="text-slate-800">
          {r.authorName}
          <span className="tabular ml-1 text-slate-500">{new Date(r.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</span>
        </dd>
        <dt className="text-slate-500">状態</dt>
        <dd className="text-slate-800">
          {REPORT_STATUS_JA[r.status] ?? r.status}
          {r.reviewedByName && r.reviewedAt && (
            <span className="tabular ml-1 text-slate-500">
              {r.reviewedByName}・{new Date(r.reviewedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            </span>
          )}
        </dd>
      </dl>
      {BODY_LABELS.map((b) => (
        <section key={b.key}>
          <h3 className="text-xs font-bold text-slate-700">{b.label}</h3>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-800">{r.body[b.key] || <span className="text-slate-400">（記入なし）</span>}</p>
        </section>
      ))}
      {(canReview || canEdit) && (
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          {canEdit && (
            <button type="button" onClick={onEdit} className={btn.secondary}>
              編集
            </button>
          )}
          {canReview && (
            <button type="button" onClick={onReview} className={btn.primary}>
              <CheckCircle2 size={14} aria-hidden />
              確認済みにする
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReportForm({ defaults, authorName, notice, onDone }: { defaults: FormDefaults; authorName: string; notice: string | null; onDone: (r: ActionResult) => void }) {
  const [result, formAction, pending] = useActionState(createReportAction, null);
  const [type, setType] = useState<ReportType>(defaults.type);
  const [teamCode, setTeamCode] = useState(defaults.teamCode);
  const [period, setPeriod] = useState({ from: defaults.periodFrom, to: defaults.periodTo });
  const [title, setTitle] = useState(defaults.title);
  const [touched, setTouched] = useState(Boolean(defaults.id));
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // 種類・部署を変えたら、タイトルを触っていなければ期間とタイトルを追従させる
  const changeType = (t: ReportType) => {
    setType(t);
    const d = defaultsFor(t, teamCode, authorName);
    setPeriod({ from: d.periodFrom, to: d.periodTo });
    if (!touched) setTitle(d.title);
  };
  const changeTeam = (c: string) => {
    setTeamCode(c);
    if (!touched) setTitle(defaultsFor(type, c, authorName).title);
  };

  return (
    <form action={formAction} className="space-y-3">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      {notice && <Notice tone="warn">{notice}</Notice>}
      {defaults.type === 'interim' && !defaults.id && <Notice tone="info">タスク状況とアラートから組み立てた下書きです。売上・広告費の数字は朝礼台本から転記し、学びを追記してから提出してください。</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="種類" required>
          <select name="type" value={type} onChange={(e) => changeType(e.target.value as ReportType)} className={inputCls}>
            {REPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {REPORT_TYPE_JA[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="部署">
          <select name="teamCode" value={teamCode} onChange={(e) => changeTeam(e.target.value)} className={inputCls}>
            <option value="">全社</option>
            {TEAM_DEFS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="期間（開始）" required>
          <input name="periodFrom" type="date" required value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} className={`${inputCls} tabular`} />
        </Field>
        <Field label="期間（終了）" required>
          <input name="periodTo" type="date" required value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} className={`${inputCls} tabular`} />
        </Field>
      </div>
      <Field label="タイトル" required>
        <input
          name="title"
          required
          maxLength={120}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTouched(true);
          }}
          className={inputCls}
        />
      </Field>
      <p className="text-[11px] text-slate-500">作成者: {authorName}（自動）</p>
      {BODY_LABELS.map((b) => (
        <Field key={b.key} label={b.label} hint={b.hint}>
          <textarea name={b.key} rows={b.key === 'numbers' || b.key === 'issues' ? 4 : 3} maxLength={2000} defaultValue={defaults.body[b.key]} className={inputCls} />
        </Field>
      ))}
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="submit" name="status" value="draft" disabled={pending} className={btn.secondary}>
          下書き保存
        </button>
        <button type="submit" name="status" value="submitted" disabled={pending} className={btn.primary}>
          {pending ? '保存中…' : '提出'}
        </button>
      </div>
    </form>
  );
}
