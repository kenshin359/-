// PRO: 社内アンケート（匿名のGoogleフォーム回答シートの可視化）。閲覧は管理職以上（代表・取締役・管理職）。
// 数字は src/lib/metrics/survey.ts の集計のみ。シートが正（ダッシュボードは読むだけ。具体策・対応チェックはシートで行う）。
// 匿名回答の本文は取得結果にも画面にも出さない（テーマ別の件数と進捗だけ）。
import type { Metadata } from 'next';
import { requireActor, atLeast, LEVEL_JA } from '@/lib/rbac';
import { Notice } from '@/components/ui';
import { getSurveyData } from '@/lib/survey-data';
import { CONSULT_JA, CONSULT_ORDER } from '@/lib/metrics/survey';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '社内アンケート' };

const TITLE = '社内アンケート — 改善ボード';

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

function monthJa(m: string): string {
  return `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;
}

export default async function SurveyPage() {
  const actor = await requireActor();
  if (!atLeast(actor.level, 'manager')) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-bold text-slate-800">{TITLE}</h1>
        <Notice tone="info">閲覧権限がありません。この画面は{LEVEL_JA.manager}以上（代表・取締役・管理職）が閲覧できます。</Notice>
      </div>
    );
  }

  const data = await getSurveyData();
  const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

  if (data.status === 'unavailable') {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-bold text-slate-800">{TITLE}</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">未接続</p>
          <p className="mt-1">{data.reason}</p>
          {data.sheetUrl && (
            <a href={data.sheetUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">
              シートを開く
            </a>
          )}
        </div>
        <p className="text-[11px] text-slate-500">匿名回答の本文は表示しません（シートで確認）。</p>
      </div>
    );
  }

  const { summary, sheetUrl, fetchedAt, tabCount, responseTabCount } = data;
  const consultTotal = CONSULT_ORDER.reduce((a, k) => a + summary.consult[k], 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">{TITLE}</h1>
          <p className="text-xs text-slate-500">
            出典: 社内アンケート回答シート（Googleフォーム → スプレッドシート・回答タブ {responseTabCount}／全 {tabCount} タブ）。最終取得 {fmt(fetchedAt)}。
            「具体策」「対応・全体共有」のチェックはシートで行います（5分以内に反映）。
          </p>
        </div>
        <a href={sheetUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
          シートを開く ↗
        </a>
      </div>

      <Notice tone="info">匿名回答の本文は表示しません（シートで確認）。この画面はテーマ別の件数と「具体策」「対応・全体共有」の進捗だけを出します。</Notice>

      {/* サマリー */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { l: '総回答', v: summary.total, cls: 'text-slate-900', sub: summary.noDate > 0 ? `日付不明 ${summary.noDate}` : null },
          { l: '未対応（対応・全体共有が未チェック）', v: summary.pending, cls: summary.pending > 0 ? 'text-amber-700' : 'text-emerald-700', sub: `対応済み ${summary.handled}` },
          {
            l: `対応遅れ（${summary.planDeadlineDays}日超で具体策なし）`,
            v: summary.overdue,
            cls: summary.overdue > 0 ? 'text-red-700' : 'text-emerald-700',
            sub: null,
          },
          { l: '具体策あり', v: summary.withPlan, cls: 'text-slate-900', sub: `具体策なし ${summary.withoutPlan}` },
        ].map((t) => (
          <div key={t.l} className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t.l}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${t.cls}`}>{t.v}</p>
            {t.sub && <p className="mt-0.5 text-[11px] text-slate-500">{t.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {/* 月別 */}
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <div className="px-3 py-2">
            <h2 className="text-sm font-bold text-slate-800">月別の回答件数</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-2 py-2 text-left">月</th>
                <th className="px-2 py-2 text-right">回答</th>
                <th className="px-2 py-2 text-right">具体策あり</th>
                <th className="px-2 py-2 text-right">対応済み</th>
                <th className="px-2 py-2 text-right">未対応</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.byMonth.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                    回答がありません
                  </td>
                </tr>
              )}
              {summary.byMonth.map((m) => (
                <tr key={m.month}>
                  <td className="px-2 py-1.5 text-slate-800">{monthJa(m.month)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{m.count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{m.withPlan}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{m.handled}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${m.pending > 0 ? 'font-semibold text-amber-700' : 'text-slate-800'}`}>{m.pending}</td>
                </tr>
              ))}
              {summary.noDate > 0 && (
                <tr>
                  <td className="px-2 py-1.5 text-slate-500">日付不明</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{summary.noDate}</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">—</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">—</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 設問別 */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">設問別の回答あり件数</h2>
          <p className="text-[11px] text-slate-500">空でない回答の数（総回答 {summary.total} 件に対する割合）</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {summary.byQuestion.map((q) => (
              <li key={q.key}>
                <div className="flex items-center justify-between">
                  <span className="text-slate-800">{q.label}</span>
                  <span className="tabular-nums text-slate-800">
                    {q.answered}
                    <span className="ml-1 text-xs text-slate-500">（{pct(q.answered, summary.total)}）</span>
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 w-full rounded bg-slate-100">
                  <div className="h-1.5 rounded bg-slate-700" style={{ width: summary.total > 0 ? `${Math.round((q.answered / summary.total) * 100)}%` : '0%' }} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* 相談相手 */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">悩みを相談できる人の内訳</h2>
          <p className="text-[11px] text-slate-500">選択肢の分類のみ（本文は出しません）</p>
          <ul className="mt-2 space-y-1 text-sm">
            {CONSULT_ORDER.filter((k) => summary.consult[k] > 0 || k === 'blank').map((k) => (
              <li key={k} className="flex items-center justify-between">
                <span className={k === 'no_worry' ? 'font-semibold text-red-700' : k === 'blank' ? 'text-slate-500' : 'text-slate-800'}>{CONSULT_JA[k]}</span>
                <span className="tabular-nums text-slate-800">
                  {summary.consult[k]}
                  <span className="ml-1 text-xs text-slate-500">（{pct(summary.consult[k], consultTotal)}）</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        判定: 未対応＝「対応・全体共有」が TRUE でない回答。対応遅れ＝回答日から{summary.planDeadlineDays}日を超えて「具体策」が空の回答（日付不明は判定しない）。
        回答は「タイムスタンプ」見出しを持つ全タブから集め、タイムスタンプと設問1が同一の行は1件に寄せています。ジム店舗の回答も含みます。
      </p>
    </div>
  );
}
