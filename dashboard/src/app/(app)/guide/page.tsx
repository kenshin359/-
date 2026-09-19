// 使える範囲マップ（全員閲覧可）: 「今どこまで使えるか」の地図。状態は src/lib/site-map.ts の定数（山本が更新）。
// 画面側で状態を判定・推測しない。紐付け番号は docs/integrations.md が正。
import Link from 'next/link';
import { requireActor } from '@/lib/rbac';
import { integrationLabel, SITE_STATUS_JA, siteMapCounts, siteMapFor, type SiteMapEntry, type SiteMode } from '@/lib/site-map';

export const dynamic = 'force-dynamic';

const HOW_TO = [
  'ログインする（ログインIDはメールアドレス）。',
  '右上の切替で STANDARD（数字を見る）／ PRO（経営・業務管理）を選ぶ。',
  'PRO の赤いタイル（アラート・期限超過）から改善タスクに入る。',
];

function StatusBadge({ status }: { status: SiteMapEntry['status'] }) {
  const s = SITE_STATUS_JA[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span aria-hidden>{s.mark}</span>
      {s.label}
    </span>
  );
}

function ModeTable({ mode, title, sub }: { mode: SiteMode; title: string; sub: string }) {
  const rows = siteMapFor(mode);
  const c = siteMapCounts(mode);
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
        <h2 className="text-sm font-bold text-slate-800">
          {title} <span className="text-xs font-normal text-slate-500">{rows.length}画面</span>
        </h2>
        <p className="text-xs text-slate-500">
          {sub} ／ {SITE_STATUS_JA.ok.mark} 稼働 {c.ok}・{SITE_STATUS_JA.partial.mark} 一部 {c.partial}・{SITE_STATUS_JA.off.mark} 未接続 {c.off}
        </p>
      </div>
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left">画面</th>
            <th className="px-2 py-2 text-left">状態</th>
            <th className="px-2 py-2 text-left">データ源</th>
            <th className="px-2 py-2 text-left">必要な紐付け</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((e) => (
            <tr key={e.href} className={`align-top hover:bg-slate-50 ${e.status === 'off' ? 'bg-slate-50/60' : ''}`}>
              <td className="px-3 py-2">
                <Link href={e.href} className="font-medium text-blue-800 hover:underline">
                  {e.label}
                </Link>
                <div className="text-[11px] text-slate-400">{e.href}</div>
              </td>
              <td className="px-2 py-2">
                <StatusBadge status={e.status} />
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                {e.source}
                {e.note && <div className="mt-0.5 text-[11px] text-slate-400">{e.note}</div>}
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                {e.needs.length === 0 ? (
                  <span className="text-slate-300">−</span>
                ) : (
                  <ul className="space-y-0.5">
                    {e.needs.map((n) => (
                      <li key={n}>{integrationLabel(n)}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function GuidePage() {
  await requireActor(); // 一般社員も閲覧可（ログインのみ必要）

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800">使える範囲マップ — 今どこまで動くか</h1>
        <p className="text-xs text-slate-500">
          状態は運用担当（山本）が更新する一覧です（src/lib/site-map.ts）。紐付け番号の一覧と残数は docs/integrations.md が正。
          「未接続」の画面は成功と偽らず、必要な紐付けを画面にも表示します。
        </p>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">使い方（3行）</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          {HOW_TO.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {(['ok', 'partial', 'off'] as const).map((s) => (
            <span key={s} className={`rounded-full px-2 py-0.5 ${SITE_STATUS_JA[s].cls}`}>
              {SITE_STATUS_JA[s].mark} {SITE_STATUS_JA[s].label}
              {s === 'ok' ? '：実データで動く' : s === 'partial' ? '：一部は未接続・デモ表示' : '：紐付け待ち（画面は「未接続」を表示）'}
            </span>
          ))}
        </div>
      </div>

      <ModeTable mode="standard" title="STANDARD" sub="数字を見る画面（サイドバー）" />
      <ModeTable mode="pro" title="PRO" sub="経営・業務管理の画面（右上で切替）" />

      <p className="text-[11px] text-slate-500">
        紐付けの詳細と担当は <Link href="/integrations" className="text-blue-800 hover:underline">データ連携設定</Link> と docs/integrations.md を参照。
      </p>
    </div>
  );
}
