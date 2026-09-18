// 報告（日報/週報/中間報告）のデータ層。本文は構造化JSON（数字・学び・次にやること・課題・依頼）。
// 朝礼の「各チーム90秒（数字→学び→今日）」と同じ順番で書けるようにする（docs/business.md §5.3）。
import { z } from 'zod';
import { prisma } from '../prisma';
import { jstDateKey } from '../metrics/format';
import { TEAM_DEFS } from './teams';
import { computeBottlenecks, type Task2Item } from './tasks2';

export const REPORT_TYPES = ['daily', 'weekly', 'interim'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_TYPE_JA: Record<ReportType, string> = { daily: '日報', weekly: '週報', interim: '中間報告' };

export const REPORT_STATUS_JA: Record<string, string> = { draft: '下書き', submitted: '提出済み', reviewed: '確認済み' };

export const ReportBody = z.object({
  numbers: z.string().trim().max(2000, '数字は2000文字以内').default(''),
  learned: z.string().trim().max(2000, '学びは2000文字以内').default(''),
  next: z.string().trim().max(2000, '次にやることは2000文字以内').default(''),
  issues: z.string().trim().max(2000, '課題は2000文字以内').default(''),
  requests: z.string().trim().max(2000, '依頼は2000文字以内').default(''),
});
export type ReportBodyType = z.infer<typeof ReportBody>;

export const BODY_LABELS: { key: keyof ReportBodyType; label: string; hint: string }[] = [
  { key: 'numbers', label: '数字', hint: '昨日/今週の実績と計画比。数字が無ければ「未取得」と書く' },
  { key: 'learned', label: '学び', hint: '数字から分かったこと（原因・仮説）' },
  { key: 'next', label: '次にやること', hint: '今日/今週の打ち手。担当と期限まで' },
  { key: 'issues', label: '課題', hint: '止まっていること・判断が必要なこと' },
  { key: 'requests', label: '依頼', hint: 'リーダー・他部署へのお願い' },
];

export const ReportInput = z.object({
  type: z.enum(REPORT_TYPES, { message: '種類を選んでください' }),
  teamCode: z
    .string()
    .trim()
    .refine((v) => v === '' || TEAM_DEFS.some((t) => t.code === v), '部署の指定が不正です'),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '期間（開始）を入力してください'),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '期間（終了）を入力してください'),
  title: z.string().trim().min(1, 'タイトルを入力してください').max(120, 'タイトルは120文字以内'),
  status: z.enum(['draft', 'submitted']).default('submitted'),
  body: ReportBody,
});
export type ReportInputType = z.infer<typeof ReportInput>;

export interface ReportItem {
  id: string;
  type: ReportType;
  teamCode: string | null;
  teamName: string;
  authorUserId: string | null;
  authorName: string;
  periodFrom: string;
  periodTo: string;
  title: string;
  body: ReportBodyType;
  status: string;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export function parseBody(raw: string): ReportBodyType {
  try {
    const r = ReportBody.safeParse(JSON.parse(raw));
    if (r.success) return r.data;
  } catch {
    /* 旧形式や壊れたJSONは本文を「数字」欄に入れて見せる */
  }
  return { numbers: raw, learned: '', next: '', issues: '', requests: '' };
}

export function teamNameOf(code: string | null): string {
  if (!code) return '全社';
  return TEAM_DEFS.find((t) => t.code === code)?.name ?? code;
}

export interface ReportFilter {
  teamCode?: string;
  type?: ReportType;
  from?: string; // periodTo >= from
  to?: string; // periodFrom <= to
  /** 一般社員は自分の報告と自チームの報告だけ */
  visibleTeamCode?: string | null;
  visibleAuthorId?: string;
}

export async function listReports(filter: ReportFilter = {}): Promise<ReportItem[]> {
  const where: Record<string, unknown> = {};
  if (filter.teamCode) where.teamCode = filter.teamCode;
  if (filter.type) where.type = filter.type;
  if (filter.from) where.periodTo = { gte: new Date(`${filter.from}T00:00:00+09:00`) };
  if (filter.to) where.periodFrom = { lte: new Date(`${filter.to}T23:59:59+09:00`) };
  if (filter.visibleAuthorId) {
    where.OR = [{ authorUserId: filter.visibleAuthorId }, ...(filter.visibleTeamCode ? [{ teamCode: filter.visibleTeamCode }] : [])];
  }
  const rows = await prisma.report.findMany({ where, orderBy: [{ periodTo: 'desc' }, { createdAt: 'desc' }], take: 300 });
  const ids = [...new Set(rows.map((r) => r.reviewedByUserId).filter((v): v is string => Boolean(v)))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    type: (REPORT_TYPES as readonly string[]).includes(r.type) ? (r.type as ReportType) : 'daily',
    teamCode: r.teamCode,
    teamName: teamNameOf(r.teamCode),
    authorUserId: r.authorUserId,
    authorName: r.authorName ?? '不明',
    periodFrom: jstDateKey(r.periodFrom),
    periodTo: jstDateKey(r.periodTo),
    title: r.title,
    body: parseBody(r.body),
    status: r.status,
    reviewedByUserId: r.reviewedByUserId,
    reviewedByName: r.reviewedByUserId ? (names.get(r.reviewedByUserId) ?? null) : null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------- リーダー向け中間報告の自動生成（決定的テンプレート・LLM不使用） ----------

export interface InterimDraft {
  type: 'interim';
  teamCode: string;
  periodFrom: string;
  periodTo: string;
  title: string;
  body: ReportBodyType;
}

export interface AlertLike {
  level: string;
  title: string;
  detail: string | null;
  teamCode: string | null;
}

function list(lines: string[]): string {
  return lines.length ? lines.map((l) => `・${l}`).join('\n') : '';
}

/** 純関数: チームのタスク状況＋アラートから中間報告の下書きを組み立てる */
export function composeInterimDraft(
  teamCode: string,
  tasks: Task2Item[],
  alerts: AlertLike[],
  now = new Date(),
): InterimDraft {
  const today = jstDateKey(now);
  const from = jstDateKey(new Date(now.getTime() - 6 * 86_400_000));
  const team = TEAM_DEFS.find((t) => t.code === teamCode);
  const teamName = team?.name ?? teamCode;
  const mine = tasks.filter((t) => t.teamCode === teamCode);
  const open = mine.filter((t) => t.displayStatus !== '完了');
  const overdue = open.filter((t) => t.due && t.due < today);
  const waiting = open.filter((t) => t.displayStatus === '確認待ち');
  const held = open.filter((t) => t.displayStatus === '保留');
  const doneThisWeek = mine.filter((t) => t.displayStatus === '完了' && t.updatedAt && jstDateKey(new Date(t.updatedAt)) >= from);
  const b = computeBottlenecks(mine, now);
  const teamAlerts = alerts.filter((a) => a.teamCode === teamCode || a.teamCode == null).sort((x, y) => (x.level === 'red' ? 0 : 1) - (y.level === 'red' ? 0 : 1));

  const numbers = [
    `未完了 ${open.length}件（期限超過 ${overdue.length}・確認待ち ${waiting.length}・保留 ${held.length}）`,
    `今週完了 ${doneThisWeek.length}件（${from}〜${today}）`,
    '売上・広告費の数字: 未取得（Kintone売上連携は未接続。朝礼台本の数字を転記してください）',
  ].join('\n');

  const learned = doneThisWeek.length
    ? `完了:\n${list(doneThisWeek.map((t) => `${t.title}（${t.assignee}）${t.doneDef ? ` — ${t.doneDef}` : ''}`))}`
    : '今週の完了タスクはありません（学びは手で追記してください）';

  const nextLines = open
    .filter((t) => t.displayStatus !== '保留')
    .sort((x, y) => x.priority.localeCompare(y.priority) || (x.due ?? '9999').localeCompare(y.due ?? '9999'))
    .slice(0, 8)
    .map((t) => `${t.title}（${t.assignee}・${t.priority}・期限 ${t.due ?? '未設定'}）`);
  const next = nextLines.length ? list(nextLines) : '未完了タスクはありません';

  const issueLines = [
    ...b.stuck.slice(0, 8).map((s) => `${s.task.title}（${s.task.assignee}）: ${s.reasons.join('・')} ${s.days}日${s.task.holdReason ? ` — ${s.task.holdReason}` : ''}`),
    ...teamAlerts.slice(0, 5).map((a) => `${a.level === 'red' ? '🔴' : '🟡'} ${a.title}${a.detail ? `: ${a.detail}` : ''}`),
  ];
  const issues = issueLines.length ? list(issueLines) : '止まっている仕事・アラートはありません';

  const reqLines = [
    ...waiting.map((t) => `「${t.title}」の確認をお願いします（${t.assignee}・確認待ち）`),
    ...held.map((t) => `「${t.title}」の保留解除の判断をお願いします${t.holdReason ? `（${t.holdReason}）` : ''}`),
  ].slice(0, 8);
  const requests = reqLines.length ? list(reqLines) : '依頼事項はありません';

  return {
    type: 'interim',
    teamCode,
    periodFrom: from,
    periodTo: today,
    title: `${teamName} 中間報告（${from.slice(5).replace('-', '/')}〜${today.slice(5).replace('-', '/')}）`,
    body: { numbers, learned, next, issues, requests },
  };
}

/** DB からアラート（未解決）を読む。Alert テーブルが無い/空でも落とさない */
export async function loadOpenAlerts(): Promise<AlertLike[]> {
  try {
    const rows = await prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: [{ level: 'desc' }, { lastSeenAt: 'desc' }], take: 100 });
    const now = Date.now();
    return rows
      .filter((a) => !a.mutedUntil || a.mutedUntil.getTime() < now)
      .map((a) => ({ level: a.level, title: a.title, detail: a.detail, teamCode: a.teamCode }));
  } catch {
    return [];
  }
}
