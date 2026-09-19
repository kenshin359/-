import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions, canWrite } from '@/lib/auth';
import { listOpenCases } from '@/lib/line-support/cases';
import { getStaffGroupId } from '@/lib/line-support/settings';
import { prisma } from '@/lib/prisma';
import { closeCaseAction } from './actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;

function fmt(d: Date): string {
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
}

/**
 * LINE公式アカウント（AI自動応答）の会話ログ。
 * 要対応（needsHuman）のやり取りを上に出し、ユーザーごとの流れも追える。
 * 返信そのものは LINE公式アカウントマネージャーのチャット画面から行う（この画面は確認用）。
 */
export default async function LinePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; user?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const sp = await searchParams;
  const filter = sp.filter === 'human' ? 'human' : 'all';
  const user = (sp.user ?? '').trim();

  const staffGroup = await getStaffGroupId();
  const configured = {
    channelSecret: Boolean((process.env.LINE_SUPPORT_CHANNEL_SECRET || '').trim()),
    accessToken: Boolean((process.env.LINE_SUPPORT_CHANNEL_ACCESS_TOKEN || '').trim()),
    anthropic: Boolean((process.env.ANTHROPIC_API_KEY || '').trim()),
    staffNotify: Boolean(staffGroup || (process.env.CHATWORK_API_TOKEN || '').trim()),
  };
  const connected = configured.channelSecret && configured.accessToken;
  const openCases = await listOpenCases(50);
  const writable = canWrite(session.user.role);

  let rows: Awaited<ReturnType<typeof prisma.lineChatLog.findMany>> = [];
  let dbError: string | null = null;
  try {
    rows = await prisma.lineChatLog.findMany({
      where: {
        ...(user ? { lineUserId: user } : {}),
        ...(filter === 'human' ? { needsHuman: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    });
  } catch (e) {
    dbError = e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : String(e);
  }

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  let stats = { in: 0, out: 0, human: 0, users: 0 };
  if (!dbError) {
    try {
      const [inCount, outCount, humanCount, distinct] = await Promise.all([
        prisma.lineChatLog.count({ where: { direction: 'in', createdAt: { gte: since } } }),
        prisma.lineChatLog.count({ where: { direction: 'out', createdAt: { gte: since } } }),
        prisma.lineChatLog.count({ where: { needsHuman: true, createdAt: { gte: since } } }),
        prisma.lineChatLog.findMany({
          where: { createdAt: { gte: since } },
          distinct: ['lineUserId'],
          select: { lineUserId: true },
        }),
      ]);
      stats = { in: inCount, out: outCount, human: humanCount, users: distinct.length };
    } catch {
      /* 集計は任意 */
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-800">LINE顧客対応（AI公式ライン）</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              connected ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {connected ? 'LINE接続設定あり' : '未接続（環境変数未設定）'}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          お客様からのLINEメッセージにAIが事実カード（config/line-ai-knowledge.json）の範囲で自動返信します。
          要対応は案件番号（#番号）付きでスタッフのLINEグループに届き、グループで「#番号 返信文」と送るとお客様に届きます。
          「完了 #番号」でAIの自動返信が再開します。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Status label="チャネルシークレット" ok={configured.channelSecret} />
          <Status label="アクセストークン" ok={configured.accessToken} />
          <Status label="AI（Anthropic APIキー）" ok={configured.anthropic} />
          <Status
            label={staffGroup ? `スタッフグループ（${staffGroup.slice(0, 6)}…）` : 'スタッフグループ（公式LINEをグループに招待すると自動登録）'}
            ok={configured.staffNotify}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="受信（7日）" value={stats.in} />
          <Stat label="AI返信（7日）" value={stats.out} />
          <Stat label="要対応（7日）" value={stats.human} accent />
          <Stat label="会話したお客様（7日）" value={stats.users} />
        </div>
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">進行中の案件（スタッフ対応中・AI自動返信は停止中）</h2>
        {openCases.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">進行中の案件はありません。</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3 whitespace-nowrap">案件</th>
                  <th className="py-2 pr-3 whitespace-nowrap">最終更新</th>
                  <th className="py-2 pr-3">お客様の最新メッセージ</th>
                  <th className="py-2 pr-3">理由</th>
                  <th className="py-2 whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {openCases.map((c) => (
                  <tr key={c.no} className="border-b border-slate-100 align-top bg-amber-50/60">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">
                      <Link href={`/pro/line-support?user=${encodeURIComponent(c.lineUserId)}`} className="text-blue-700 underline">
                        #{c.no}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">{fmt(c.updatedAt)}</td>
                    <td className="py-2 pr-3 whitespace-pre-wrap text-slate-800">{c.lastUserText}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{c.reason}</td>
                    <td className="py-2 whitespace-nowrap">
                      {writable ? (
                        <form action={closeCaseAction}>
                          <input type="hidden" name="no" value={c.no} />
                          <button className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
                            完了にする
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-slate-400">閲覧のみ</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">
              お客様への返信はスタッフのLINEグループから「#番号 返信文」で送れます。48時間動きが無い案件は自動的に閉じたものとして扱います。
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            href="/pro/line-support"
            className={`rounded-full px-3 py-1 ${filter === 'all' && !user ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            すべて
          </Link>
          <Link
            href="/pro/line-support?filter=human"
            className={`rounded-full px-3 py-1 ${filter === 'human' ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            要対応のみ
          </Link>
          {user && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              ユーザー: {user.slice(0, 8)}…{' '}
              <Link href="/pro/line-support" className="text-blue-700 underline">
                解除
              </Link>
            </span>
          )}
        </div>

        {dbError ? (
          <p className="mt-4 text-sm text-red-600">
            会話ログを読み込めません（DBマイグレーション未適用の可能性）: {dbError}
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">まだ会話はありません。</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3 whitespace-nowrap">日時</th>
                  <th className="py-2 pr-3 whitespace-nowrap">ユーザー</th>
                  <th className="py-2 pr-3 whitespace-nowrap">方向</th>
                  <th className="py-2 pr-3">本文</th>
                  <th className="py-2 whitespace-nowrap">要対応・話題</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-b border-slate-100 align-top ${r.needsHuman ? 'bg-amber-50/60' : ''}`}>
                    <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">{fmt(r.createdAt)}</td>
                    <td className="py-2 pr-3 text-xs">
                      <Link href={`/pro/line-support?user=${encodeURIComponent(r.lineUserId)}`} className="text-blue-700 underline">
                        {r.lineUserId.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {r.direction === 'in' ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">お客様</span>
                      ) : r.reason?.startsWith('スタッフ返信') ? (
                        <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">スタッフ</span>
                      ) : (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">AI</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-pre-wrap text-slate-800">{r.text}</td>
                    <td className="py-2 text-xs text-slate-600">
                      {r.needsHuman && (
                        <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">要対応</span>
                      )}
                      {r.reason && <div className="text-[11px] text-slate-500">{r.reason}</div>}
                      {r.topics && <div className="text-[11px] text-slate-400">{r.topics}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Status({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 px-2 py-1.5">
      <span className={ok ? 'text-green-700' : 'text-amber-700'}>{ok ? '● 設定済み' : '○ 未設定'}</span>
      <span className="ml-1 text-slate-600">{label}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${accent && value > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}
