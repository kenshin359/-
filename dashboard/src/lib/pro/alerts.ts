// アラートセンターのルールエンジン。ルールで候補を作り、Alert テーブルへ集約（code+entityType+entityId で1件）。
// 解消したものは resolvedAt を立ててクローズ。ミュート（mutedUntil）中は一覧に出さないが評価は続ける。
// ルールの出典: docs/pro-plan.md §5⑧、docs/business.md §6。閾値は overview.ts の THRESHOLDS。
import { prisma } from '../prisma';
import { jstDateKey } from '../metrics/format';
import { listTasks, type TaskItem } from '../tasks';
import { canSeeCompanyWide, type Actor } from '../rbac';
import { teamByCode, teamByKintoneLabel } from './teams';
import type { MonthlyOverview } from './kpi-kintone';
import { THRESHOLDS, judgeAdRatio, judgePace } from './overview';
import { isOverdue as isCreativeOverdue, type CreativeRequest } from '../metrics/creative-requests';

export type AlertLevel = 'red' | 'yellow';

export const ALERT_CODES = [
  'task_overdue',
  'waiting_stale',
  'no_assignee',
  'stale_update',
  'task_concentration',
  'sales_pace',
  'ad_ratio',
  'creative_overdue',
] as const;
export type AlertCode = (typeof ALERT_CODES)[number];

/** タスク由来のルール（タスク一覧が取れたときに必ず評価する） */
const TASK_RULES: AlertCode[] = ['task_overdue', 'waiting_stale', 'no_assignee', 'stale_update', 'task_concentration'];
/** KPI由来のルール（Kintone KPI(30) が取れたときだけ評価する。未接続時は触らない） */
const KPI_RULES: AlertCode[] = ['sales_pace', 'ad_ratio'];
/** 制作依頼シート由来のルール（シートが取れたときだけ評価する） */
const CREATIVE_RULES: AlertCode[] = ['creative_overdue'];

export interface AlertCandidate {
  code: AlertCode;
  level: AlertLevel;
  title: string;
  detail: string;
  entityType: 'task' | 'kpi' | 'user' | 'creative';
  entityId: string;
  teamCode: string | null;
}

export interface AlertInputs {
  tasks: TaskItem[];
  /** null = KPI未取得（KPIルールは評価しない） */
  monthly: MonthlyOverview | null;
  /** null = 制作依頼シート未取得（制作ルールは評価しない） */
  creative?: CreativeRequest[] | null;
  now?: Date;
}

const DAY = 86_400_000;

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / DAY);
}

function teamCodeOf(label: string): string | null {
  return teamByKintoneLabel(label)?.code ?? null;
}

function isUnassigned(assignee: string): boolean {
  const a = assignee.trim();
  return a === '' || a === '未割当';
}

/** 純関数: 入力からアラート候補を作る（DBに触らない） */
export function buildAlertCandidates(inputs: AlertInputs): AlertCandidate[] {
  const now = inputs.now ?? new Date();
  const today = jstDateKey(now);
  const out: AlertCandidate[] = [];
  const byAssignee = new Map<string, number>();

  for (const t of inputs.tasks) {
    if (t.status === '完了') continue;
    const teamCode = teamCodeOf(t.team);
    const who = isUnassigned(t.assignee) ? '未割当' : t.assignee;
    const base = `${t.team || '—'} / ${who}`;

    if (t.due && t.due < today) {
      const over = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.due}T00:00:00Z`)) / DAY);
      out.push({
        code: 'task_overdue',
        level: 'red',
        title: `期限超過: ${t.title}`,
        detail: `${base} / 期限 ${t.due}（${over}日超過）${t.priority === 'P1' ? ' / P1' : ''}`,
        entityType: 'task',
        entityId: t.id,
        teamCode,
      });
    }

    const since = daysSince(t.updatedAt, now);
    if (t.status === '確認待ち' && since != null && since >= THRESHOLDS.waitingStaleDays) {
      out.push({
        code: 'waiting_stale',
        level: 'yellow',
        title: `確認待ちが${since}日滞留: ${t.title}`,
        detail: `${base} / 誰の確認で止まっているか決めてください`,
        entityType: 'task',
        entityId: t.id,
        teamCode,
      });
    }

    if (isUnassigned(t.assignee)) {
      out.push({
        code: 'no_assignee',
        level: 'yellow',
        title: `担当者未設定: ${t.title}`,
        detail: `${t.team || '—'} / 期限 ${t.due ?? 'なし'}`,
        entityType: 'task',
        entityId: t.id,
        teamCode,
      });
    } else {
      byAssignee.set(t.assignee, (byAssignee.get(t.assignee) ?? 0) + 1);
    }

    if (since != null && since >= THRESHOLDS.staleUpdateDays && t.status !== '確認待ち') {
      out.push({
        code: 'stale_update',
        level: 'yellow',
        title: `${since}日更新なし: ${t.title}`,
        detail: `${base} / 状態「${t.status}」のまま。進めるか止めるか決めてください`,
        entityType: 'task',
        entityId: t.id,
        teamCode,
      });
    }
  }

  for (const [assignee, n] of byAssignee) {
    if (n >= THRESHOLDS.concentrationOpenAt) {
      out.push({
        code: 'task_concentration',
        level: 'yellow',
        title: `タスク集中: ${assignee} さんに未完了 ${n}件`,
        detail: `${THRESHOLDS.concentrationOpenAt}件以上。P1から順に絞るか、分担を見直してください`,
        entityType: 'user',
        entityId: assignee,
        teamCode: null,
      });
    }
  }

  const m = inputs.monthly;
  if (m) {
    if (judgePace(m.pace) === 'danger' && m.pace.kind === 'value') {
      const req = m.requiredDailyMain.kind === 'value' ? ` / 必要日販 ¥${m.requiredDailyMain.value.toLocaleString('ja-JP')}` : '';
      out.push({
        code: 'sales_pace',
        level: 'red',
        title: `目標未達ペース: 計画比 ${(m.pace.value * 100).toFixed(0)}%`,
        detail: `${m.elapsedDays}/${m.daysInMonth}日経過で累計 ¥${m.monthToDate.toLocaleString('ja-JP')}（目標 ¥${m.targets.main.toLocaleString('ja-JP')}${m.targets.isDefault ? '・仮置き' : ''}）${req}`,
        entityType: 'kpi',
        entityId: 'sales_pace',
        teamCode: 'exec',
      });
    }
    const j = judgeAdRatio(m.adRatio);
    if ((j === 'warn' || j === 'danger') && m.adRatio.kind === 'value') {
      out.push({
        code: 'ad_ratio',
        level: j === 'danger' ? 'red' : 'yellow',
        title: `広告費率 ${m.adRatio.value.toFixed(1)}%（${j === 'danger' ? `許容${THRESHOLDS.adRatioWarnMax}%超過` : `目標${THRESHOLDS.adRatioOkMax}%超過`}）`,
        detail: `今月の広告費 ¥${m.adTotal.toLocaleString('ja-JP')} ÷ 売上 ¥${m.monthToDate.toLocaleString('ja-JP')}`,
        entityType: 'kpi',
        entityId: 'ad_ratio',
        teamCode: 'ads',
      });
    }
  }

  // 制作依頼: 納期を過ぎて未完了（LP・広告の画像制作）。担当未定は詳細に明記
  if (inputs.creative) {
    for (const r of inputs.creative) {
      if (!isCreativeOverdue(r, today)) continue;
      const days = daysSince(r.dueDate, now) ?? 0;
      out.push({
        code: 'creative_overdue',
        level: days >= 3 ? 'red' : 'yellow',
        title: `制作依頼の納期超過: ${r.no || `行${r.rowNo}`} ${r.media} ${r.usage}`.trim(),
        detail: `納期 ${r.dueDate}（${days}日超過）／依頼者 ${r.requester || '不明'}／作成者 ${r.designer || '未定'}／状態 ${r.statusRaw || '依頼'}`,
        entityType: 'creative',
        entityId: `${r.no || 'row'}-${r.rowNo}`,
        teamCode: teamCodeOf('LP'),
      });
    }
  }
  return out;
}

function keyOf(a: { code: string; entityType: string | null; entityId: string | null }): string {
  return `${a.code}|${a.entityType ?? ''}|${a.entityId ?? ''}`;
}

/** 手動「解決」の印: resolveAlertAction は resolvedAt と lastSeenAt を同じ時刻にする（列を増やさずに区別する） */
export function isManuallyResolved(a: { resolvedAt: Date | null; lastSeenAt: Date }): boolean {
  return a.resolvedAt != null && a.resolvedAt.getTime() === a.lastSeenAt.getTime();
}

/**
 * ルールを評価して Alert テーブルへ反映する。
 * 入力が無ければタスク一覧を取りに行く（KPIは呼び出し側が渡したときだけ評価）。
 */
export async function evaluateAlerts(inputs?: Partial<AlertInputs>): Promise<{ fired: number; resolved: number }> {
  const now = inputs?.now ?? new Date();
  const tasks = inputs?.tasks ?? (await listTasks()).tasks;
  const monthly = inputs?.monthly ?? null;
  const creative = inputs?.creative ?? null;
  const candidates = buildAlertCandidates({ tasks, monthly, creative, now });

  const activeCodes: AlertCode[] = [...TASK_RULES, ...(monthly ? KPI_RULES : []), ...(creative ? CREATIVE_RULES : [])];
  const existing = await prisma.alert.findMany({ where: { code: { in: activeCodes } } });
  const existingByKey = new Map(existing.map((e) => [keyOf(e), e] as const));

  const ops = [];
  const desiredKeys = new Set<string>();
  let fired = 0;
  for (const c of candidates) {
    const k = keyOf(c);
    if (desiredKeys.has(k)) continue;
    desiredKeys.add(k);
    const cur = existingByKey.get(k);
    if (!cur) {
      fired++;
      ops.push(
        prisma.alert.create({
          data: {
            code: c.code,
            level: c.level,
            title: c.title,
            detail: c.detail,
            entityType: c.entityType,
            entityId: c.entityId,
            teamCode: c.teamCode,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        }),
      );
      continue;
    }
    // 手動で「解決」したもの（resolvedAt === lastSeenAt の印）は、条件が続いている間は再表示しない。
    // 条件が一度消えて再発したときだけ再オープンする（下の「印を外す」処理）。
    if (isManuallyResolved(cur)) {
      ops.push(prisma.alert.update({ where: { id: cur.id }, data: { level: c.level, title: c.title, detail: c.detail } }));
      continue;
    }
    const reopened = cur.resolvedAt != null;
    if (reopened) fired++;
    ops.push(
      prisma.alert.update({
        where: { id: cur.id },
        data: {
          level: c.level,
          title: c.title,
          detail: c.detail,
          teamCode: c.teamCode,
          lastSeenAt: now,
          resolvedAt: null,
          ...(reopened ? { firstSeenAt: now, mutedUntil: null } : {}),
        },
      }),
    );
  }

  const toResolve = existing.filter((e) => e.resolvedAt == null && !desiredKeys.has(keyOf(e))).map((e) => e.id);
  if (toResolve.length) {
    ops.push(prisma.alert.updateMany({ where: { id: { in: toResolve } }, data: { resolvedAt: now } }));
  }
  // 手動解決済みで条件が消えたもの: 印を外す（次に再発したら再オープンされる）
  for (const e of existing) {
    if (isManuallyResolved(e) && !desiredKeys.has(keyOf(e)) && e.resolvedAt) {
      ops.push(prisma.alert.update({ where: { id: e.id }, data: { lastSeenAt: new Date(e.resolvedAt.getTime() - 1000) } }));
    }
  }

  // 1トランザクションにまとめる（件数はタスク数以下）。大きすぎる場合は分割
  for (let i = 0; i < ops.length; i += 100) {
    await prisma.$transaction(ops.slice(i, i + 100));
  }
  return { fired, resolved: toResolve.length };
}

export interface AlertItem {
  id: string;
  code: AlertCode | string;
  level: AlertLevel;
  title: string;
  detail: string | null;
  entityType: string | null;
  entityId: string | null;
  teamCode: string | null;
  teamName: string | null;
  /** 対象へのリンク（タスク→/tasks 検索、KPI→経営ダッシュボード） */
  href: string;
  firstSeenAt: string;
  lastSeenAt: string;
  mutedUntil: string | null;
}

function hrefOf(a: { entityType: string | null; entityId: string | null; title: string; code: string }): string {
  if (a.entityType === 'task') {
    // タイトルは「期限超過: タスク名」の形なので、コロン以降で検索する
    const q = a.title.replace(/^[^:]*: /, '');
    return `/tasks?q=${encodeURIComponent(q)}`;
  }
  if (a.entityType === 'user' && a.entityId) return `/tasks?q=${encodeURIComponent(a.entityId)}`;
  if (a.code === 'ad_ratio') return '/ads';
  if (a.entityType === 'creative') return '/pro/creative';
  return '/pro';
}

/** 未解決・ミュート中でないアラート。一般社員は自チームのみ、リーダー以上は全社 */
export async function listOpenAlerts(actor: Actor, now = new Date()): Promise<AlertItem[]> {
  const companyWide = canSeeCompanyWide(actor.level);
  if (!companyWide && !actor.teamCode) return [];
  const rows = await prisma.alert.findMany({
    where: {
      resolvedAt: null,
      OR: [{ mutedUntil: null }, { mutedUntil: { lt: now } }],
      ...(companyWide ? {} : { teamCode: actor.teamCode }),
    },
    orderBy: [{ level: 'asc' }, { lastSeenAt: 'desc' }], // 'red' < 'yellow'
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    level: r.level === 'red' ? 'red' : 'yellow',
    title: r.title,
    detail: r.detail,
    entityType: r.entityType,
    entityId: r.entityId,
    teamCode: r.teamCode,
    teamName: r.teamCode ? (teamByCode(r.teamCode)?.name ?? r.teamCode) : null,
    href: hrefOf(r),
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    mutedUntil: r.mutedUntil ? r.mutedUntil.toISOString() : null,
  }));
}
