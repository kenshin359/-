// PRO設定: (a) 自分のプロフィール (b) 権限・所属の一覧編集（管理者のみ） (c) 閾値の表示 (d) 連携状態。
// 管理者以外には (b) のデータを渡さない（画面の出し分けだけでなく、サーバーで取得自体を行わない）。
import { prisma } from '@/lib/prisma';
import { LEVELS, LEVEL_JA, requireActor } from '@/lib/rbac';
import { ROLE_JA } from '@/lib/users';
import { listTasks } from '@/lib/tasks';
import { teamOptions } from '@/lib/pro/people';
import { teamByCode } from '@/lib/pro/teams';
import SettingsView, { type ThresholdRow, type UserRowData } from './SettingsView';

export const dynamic = 'force-dynamic';

// docs/business.md §6「KPIと判定基準」の転記。現時点ではコード定数（daily-report-system / src/lib/metrics）で、
// この画面からは変更できない。閾値をDB化する際はここを Setting テーブル読み出しに置き換える。
const THRESHOLDS: ThresholdRow[] = [
  { name: '月間目標', rule: 'メイン 1.1億円 / ストレッチ 1.2億円', source: 'daily-report-system/config/chorei/events-YYYY-MM.json' },
  { name: '日次目標', rule: '月目標 × その日の重み ÷ 月内の重み合計（通常1.0・楽天マラソン1.7・スーパーSALE/スマイルセール2.0・最終日1.2〜1.3）', source: '同上・newsDaily.py' },
  { name: '日次判定', rule: '売上÷日次目標 ≥1.0 🟢 / ≥0.7 🟡 / 未満 🔴', source: 'newsDaily.py' },
  { name: '合算CPA', rule: '¥4,500以下 🟢 / ¥6,000以下 🟡 / 超過 🔴（客単価3万×15%/20%）', source: 'buildCpaSheet.py' },
  { name: '広告比率', rule: '広告費÷スーツケース売上 15%以下 目標 / 20%以下 許容', source: 'buildCpaSheet.py・kpiSchema.js' },
  { name: '広告費率（AI指摘）', rule: '広告費÷売上 30%超で指摘', source: 'prompts/team/02-finance.md' },
  { name: 'ROAS', rule: '2.0未満 ⚠️。デイリーニュースは費用3,000円以上の広告で ≥300% 🏆 / <300% ⚠️', source: 'newsDaily.py' },
  { name: '朝礼の広告基準', rule: 'CV単価 3,000円以下 / クリック単価 10円以下', source: 'docs/business.md §5.3' },
  { name: '売上変動', rule: '直近14日中央値比 −15%以下 ⚠️ / +15%以上 🔺（チャネル別 −30% / +50%）', source: 'lib/salesAlert.js' },
  { name: '在庫', rule: '残りわずか=10個以下、欠品=FBA・CS両方0、前回比 −20%以下で注意', source: 'lib/stock.js' },
  { name: '欠品の疑い', rule: '平均3個/日以上の商品が連続2日以上ゼロ', source: 'boardBrief.js' },
  { name: 'レビュー', rule: '星3以下 or 危険キーワードで担当者エスカレーション', source: 'config/reply-blocks.json' },
  { name: 'タスク負荷（担当者）', rule: '期限超過あり 🔴 / 未完了8件以上 🟡 / 3件以下 🟢', source: 'src/app/(app)/tasks/TaskBoard.tsx' },
];

export default async function Page() {
  const actor = await requireActor();
  const isAdmin = actor.role === 'admin';

  const [me, taskRes, users] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true, name: true, email: true, role: true, level: true, teamCode: true, title: true, kintoneName: true, skills: true, lineUserId: true },
    }),
    listTasks().catch(() => null),
    isAdmin
      ? prisma.user.findMany({
          orderBy: [{ teamCode: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, email: true, role: true, level: true, teamCode: true, title: true, kintoneName: true, skills: true, lineUserId: true },
        })
      : Promise.resolve([]),
  ]);
  if (!me) throw new Error('ユーザーが見つかりません');

  const toRow = (u: (typeof users)[number]): UserRowData => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roleJa: ROLE_JA[u.role] ?? u.role,
    isAdminRole: u.role === 'admin',
    level: (LEVELS as readonly string[]).includes(u.level) ? u.level : 'staff',
    teamCode: u.teamCode ?? '',
    title: u.title ?? '',
    kintoneName: u.kintoneName ?? '',
    skills: u.skills ?? '',
    lineUserId: u.lineUserId ?? '',
  });

  return (
    <SettingsView
      self={{
        ...toRow(me),
        levelJa: LEVEL_JA[actor.level],
        teamName: me.teamCode ? (teamByCode(me.teamCode)?.name ?? me.teamCode) : '未設定',
      }}
      isAdmin={isAdmin}
      users={users.map(toRow)}
      levels={LEVELS.map((l) => ({ code: l, name: LEVEL_JA[l] }))}
      teams={teamOptions()}
      members={taskRes?.options.members ?? []}
      thresholds={THRESHOLDS}
    />
  );
}
