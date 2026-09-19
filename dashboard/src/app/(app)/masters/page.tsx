// 各種マスター管理（STANDARD）: マスターの件数（実データ／デモの内訳）と各マスター画面へのリンク。
// 件数の集計とデモ判定は src/lib/metrics/masters.ts のみ（判定規則は prisma/seed.ts の定義）。
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getMasterCounts } from '@/lib/masters-data';
import type { MasterKind } from '@/lib/metrics/masters';

export const dynamic = 'force-dynamic';

const num = (n: number) => n.toLocaleString('ja-JP');

/** 各マスターの編集画面。無いものは件数のみ表示（注記に登録元を書く） */
const SCREENS: Record<MasterKind, { href?: string; hrefLabel?: string; adminOnly?: boolean; note: string }> = {
  channel: { note: '楽天／Amazon／自社サイト。売上取込のチャネル区分（docs/business.md §3）' },
  media: { note: 'Meta（トラベル／カタログ）／楽天RPP／Amazon広告／Google。広告費取込の媒体区分（docs/business.md §4）' },
  warehouse: { note: '実運用は FBA と CS の2倉庫（docs/business.md G-9）。在庫報告(35) 接続時に fba／cs で登録' },
  supplier: { note: '仕入先。入荷予定は Kintone 在庫報告(35) が正' },
  series: { note: '商品グループ（スーツケースS/M/L・クラシックアルミ 等）。正式名は config/product-aliases.json（docs/business.md §2.1）' },
  sku: { note: 'SKU採番と対応表は docs/business.md §2.2。表示名は daily-report-system/config/sku-names.json' },
  skuCost: { note: '有効期間付き原価。実データは原価率の提供待ち（docs/integrations.md A6）' },
  user: { href: '/masters/users', hrefLabel: 'ユーザー管理', adminOnly: true, note: 'ログインID（メール）・ロール・パスワード。権限レベル（5段階）は PRO 社員・組織で' },
};

const OTHER_LINKS = [
  { href: '/pro/people', label: '社員・組織（権限レベル・部署）', note: 'PRO。名簿の受領後に一括登録（docs/integrations.md B3）' },
  { href: '/pro/settings', label: 'PRO設定（閾値・通知）', note: 'PRO。アラートの閾値と通知先' },
  { href: '/integrations', label: 'データ連携設定', note: '外部連携の接続状態（未接続は未接続と表示）' },
];

export default async function MastersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const isAdmin = session.user.role === 'admin';
  const counts = await getMasterCounts();
  const realTotal = counts.reduce((s, c) => s + c.real, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800">各種マスター管理</h1>
        <p className="text-xs text-slate-500">
          ダッシュボードDBのマスター件数。「実データ」はデモ判定（prisma/seed.ts が作る行: demo- コード・main 倉庫・sup-a 仕入先・@demo.local）に当たらない件数。
          {realTotal === 0 ? ' 現在、実データのマスターはありません（すべてデモ）。' : ''}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">マスター</th>
              <th className="px-2 py-2 text-right">実データ</th>
              <th className="px-2 py-2 text-right">デモ</th>
              <th className="px-2 py-2 text-right">合計</th>
              <th className="px-2 py-2 text-left">画面</th>
              <th className="px-2 py-2 text-left">備考</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {counts.map((c) => {
              const s = SCREENS[c.kind];
              const canOpen = s.href && (!s.adminOnly || isAdmin);
              return (
                <tr key={c.kind} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">{c.label}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${c.real > 0 ? 'font-semibold text-slate-900' : 'text-slate-300'}`}>{num(c.real)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{num(c.demo)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-700">{num(c.total)}</td>
                  <td className="px-2 py-2">
                    {canOpen ? (
                      <Link href={s.href!} className="text-xs font-medium text-blue-800 hover:underline">
                        {s.hrefLabel} →
                      </Link>
                    ) : s.href ? (
                      <span className="text-xs text-slate-400">{s.hrefLabel}（管理者のみ）</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">件数のみ</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">{s.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">関連する設定画面</h2>
        <div className="mt-2 divide-y divide-slate-100">
          {OTHER_LINKS.map((l) => (
            <div key={l.href} className="flex items-center justify-between py-2">
              <div>
                <Link href={l.href} className="text-sm font-medium text-blue-800 hover:underline">
                  {l.label} →
                </Link>
                <p className="text-xs text-slate-400">{l.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        マスターの編集画面（チャネル・媒体・倉庫・仕入先・商品・原価）は未実装です。数字はDBの件数のみで、推測値は表示しません。
      </p>
    </div>
  );
}
