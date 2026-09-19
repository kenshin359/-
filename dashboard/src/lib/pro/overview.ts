// PRO 経営ダッシュボードのデータ層。「会社の状態が5〜10秒で分かる」ための KPI タイル・判断事項・部署カードを組み立てる。
// 数字の出どころ: Kintone 毎朝KPI報告(30)（売上・広告費）、タスク管理(38)/ローカルDB（タスク）、Alert テーブル（ルール生成）。
// 数字は作らない。未接続・未取込は「未接続」「未取得」を返し、判定は 'na' にする。
import { prisma } from '../prisma';
import { getCreativeData } from '../creative-data';
import { jstDateKey, formatYen } from '../metrics/format';
import { computePeriodMetrics } from '../metrics/compute';
import type { MetricValue } from '../metrics/types';
import { computeBoardStats, listTasks, type TaskItem } from '../tasks';
import { canSeeConfidential, redactConfidential, type Actor } from '../rbac';
import { TEAM_DEFS, teamByKintoneLabel } from './teams';
import { computeMonthlyOverview, fetchKpiMonths, type MonthlyOverview, type MonthTargets } from './kpi-kintone';
import { evaluateAlerts, listOpenAlerts, type AlertItem } from './alerts';

/**
 * 判定の閾値（現場基準）。出典は docs/business.md §6「KPIと判定基準」と docs/pro-plan.md §5⑧。
 * 画面（JSX）に数値を直書きしない。設定画面で上書きできるようにするときはここを読む側に寄せる。
 */
export const THRESHOLDS = {
  /** 月間目標 メイン 1.1億円（business.md §6。9月は8月と同額を仮置き・未確定） */
  targetMainDefault: 110_000_000,
  /** 月間目標 ストレッチ 1.2億円（同上） */
  targetStretchDefault: 120_000_000,
  /** 目標ペース（累計 ÷ 経過日按分の目標）。≥1.0 🟢 / ≥0.9 🟡 / 未満 🔴（pro-plan §5⑧ 目標未達ペース） */
  paceOk: 1.0,
  paceWarn: 0.9,
  /** 広告費率（広告費 ÷ 売上）。目標15%以下 🟢 / 許容20%以下 🟡 / 超過 🔴（business.md §6 広告比率、KPIアプリ「目標15%以下」） */
  adRatioOkMax: 15,
  adRatioWarnMax: 20,
  /** 期限超過タスク件数。0 🟢 / 1〜2 🟡 / 3以上 🔴（朝礼③タスクボード「期限超過」） */
  overdueWarnAt: 1,
  overdueDangerAt: 3,
  /** 確認待ち滞留: 「確認待ち」のまま更新が N 日以上ない（pro-plan §5⑧ 🟡確認待ち滞留） */
  waitingStaleDays: 3,
  waitingWarnAt: 1,
  waitingDangerAt: 3,
  /** 長期未更新: 未完了タスクが N 日更新されていない（pro-plan §5⑧ 長期未更新） */
  staleUpdateDays: 14,
  /** タスク集中: 1人の未完了が N 件以上（TaskBoard の「多め」判定と同じ8件） */
  concentrationOpenAt: 8,
  /** 重要アラート（🔴）件数。0 🟢 / 1〜2 🟡 / 3以上 🔴 */
  redAlertWarnAt: 1,
  redAlertDangerAt: 3,
} as const;

export type Judgment = 'ok' | 'warn' | 'danger' | 'na';

/** 目標ペースの判定 */
export function judgePace(p: MetricValue): Judgment {
  if (p.kind === 'na') return 'na';
  if (p.value >= THRESHOLDS.paceOk) return 'ok';
  if (p.value >= THRESHOLDS.paceWarn) return 'warn';
  return 'danger';
}

/** 広告費率（%）の判定 */
export function judgeAdRatio(r: MetricValue): Judgment {
  if (r.kind === 'na') return 'na';
  if (r.value <= THRESHOLDS.adRatioOkMax) return 'ok';
  if (r.value <= THRESHOLDS.adRatioWarnMax) return 'warn';
  return 'danger';
}

/** 件数系（期限超過・確認待ち滞留・重要アラート）の判定。warnAt 未満は ok、dangerAt 以上は danger */
export function judgeCount(n: number, warnAt: number, dangerAt: number): Judgment {
  if (n >= dangerAt) return 'danger';
  if (n >= warnAt) return 'warn';
  return 'ok';
}

/** 「確認待ち」のまま THRESHOLDS.waitingStaleDays 日以上更新が無いタスク */
export function waitingStaleTasks(tasks: TaskItem[], now = new Date()): TaskItem[] {
  const limit = now.getTime() - THRESHOLDS.waitingStaleDays * 86_400_000;
  return tasks.filter((t) => t.status === '確認待ち' && t.updatedAt != null && new Date(t.updatedAt).getTime() < limit);
}

export interface KpiTile {
  key: string;
  label: string;
  /** 表示値（未取得のときは理由の文言） */
  value: string;
  sub: string | null;
  judgment: Judgment;
  /** 判定の一言理由 */
  reason: string;
  href: string | null;
}

export interface Decision {
  kind: 'alert' | 'task';
  level: 'red' | 'yellow';
  title: string;
  detail: string;
  href: string;
}

export interface TeamCard {
  code: string;
  name: string;
  leader: string | null;
  /** Kintone のチーム選択肢に対応が無い部署は null（集計できない） */
  open: number | null;
  overdue: number | null;
  waiting: number | null;
  href: string;
}

export interface CompanyOverview {
  month: string;
  today: string;
  kpi:
    | { status: 'ok'; appId: string; latestDate: string | null; dataDays: number; source: 'kintone' | 'cache'; cachedAt: string | null }
    | { status: 'unavailable'; appId: string; reason: string };
  monthly: MonthlyOverview | null;
  tasks: { source: 'kintone' | 'local'; notice: string | null; open: number; overdue: number; waitingStale: number };
  alerts: { red: number; yellow: number };
  tiles: KpiTile[];
  decisions: Decision[];
  teams: TeamCard[];
  /** 粗利を見られる権限か（管理職以上） */
  canSeeProfit: boolean;
}

function pct(m: MetricValue, digits = 1): string {
  return m.kind === 'na' ? m.reason : `${m.value.toFixed(digits)}%`;
}

function yen(m: MetricValue): string {
  return m.kind === 'na' ? m.reason : formatYen(m.value);
}

function changeText(m: MetricValue): string {
  if (m.kind === 'na') return m.reason;
  const sign = m.value >= 0 ? '+' : '';
  return `${sign}${m.value.toFixed(1)}%`;
}

async function loadTargets(month: string): Promise<MonthTargets> {
  // Target テーブルに demo フラグが無いため、実データ（demo=false の受注）が1件も無い間は
  // デモシードの目標値を使わず、現場の既定値（1.1億/1.2億・仮置き）を出す
  const realOrders = await prisma.order.count({ where: { demo: false } });
  if (realOrders === 0) {
    return { main: THRESHOLDS.targetMainDefault, stretch: THRESHOLDS.targetStretchDefault, isDefault: true };
  }
  const rows = await prisma.target.findMany({
    where: { month, scope: 'all', scopeCode: 'all', metric: { in: ['sales', 'sales_stretch'] } },
    select: { metric: true, amount: true },
  });
  const main = rows.find((r) => r.metric === 'sales')?.amount ?? null;
  const stretch = rows.find((r) => r.metric === 'sales_stretch')?.amount ?? null;
  return {
    main: main ?? THRESHOLDS.targetMainDefault,
    stretch: stretch ?? THRESHOLDS.targetStretchDefault,
    isDefault: main == null,
  };
}

/** 粗利（暫定）: 実データ（demo=false）の受注明細が当月にあるときだけ計算。無ければ null と理由 */
async function loadGrossProfit(month: string): Promise<{ value: number | null; note: string }> {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, -9));
  const to = new Date(Date.UTC(y, m, 1, -9));
  const orders = await prisma.order.findMany({
    where: { demo: false, orderDate: { gte: from, lt: to } },
    select: {
      id: true,
      status: true,
      shipDate: true,
      orderDate: true,
      shippingRevenue: true,
      discount: true,
      channel: { select: { code: true } },
      items: { select: { skuId: true, qty: true, unitPrice: true, costAtSale: true } },
      refunds: { select: { refundDate: true, amount: true } },
    },
    take: 5000,
  });
  if (orders.length === 0) return { value: null, note: '未取得（原価未登録・実売上未取込）' };
  const metrics = computePeriodMetrics({
    orders: orders.map((o) => ({
      orderId: o.id,
      channelCode: o.channel.code,
      date: jstDateKey(o.shipDate ?? o.orderDate),
      status: o.status as 'ordered' | 'shipped' | 'cancelled',
      shippingRevenue: o.shippingRevenue,
      discount: o.discount,
    })),
    items: orders.flatMap((o) =>
      o.items.map((i) => ({ orderId: o.id, skuCode: i.skuId, qty: i.qty, unitPrice: i.unitPrice, costAtSale: i.costAtSale })),
    ),
    refunds: orders.flatMap((o) => o.refunds.map((r) => ({ orderId: o.id, date: jstDateKey(r.refundDate), amount: r.amount }))),
    ads: [],
    access: null,
    costs: [],
  });
  if (metrics.cogsMissingLines === metrics.orderCount && metrics.cogs === 0) {
    return { value: null, note: '未取得（原価未登録）' };
  }
  return {
    value: metrics.grossProfit,
    note: metrics.cogsMissingLines > 0 ? `暫定（原価未登録 ${metrics.cogsMissingLines}件）` : '売上明細より',
  };
}

function taskHref(t: TaskItem): string {
  return `/tasks?q=${encodeURIComponent(t.title)}`;
}

export async function getCompanyOverview(actor: Actor, now = new Date()): Promise<CompanyOverview> {
  const today = jstDateKey(now);
  const month = today.slice(0, 7);

  const [kpiRes, taskList, targets, profitRaw, creative] = await Promise.all([
    fetchKpiMonths(month),
    listTasks(),
    loadTargets(month),
    loadGrossProfit(month).catch(() => ({ value: null, note: '未取得（集計エラー）' })),
    getCreativeData(now).catch(() => null),
  ]);

  const monthly = kpiRes.status === 'ok' ? computeMonthlyOverview(month, kpiRes.rows, kpiRes.prevRows, targets) : null;
  const tasks = taskList.tasks;
  const stats = computeBoardStats(tasks, now);
  const waitingStale = waitingStaleTasks(tasks, now);

  // アラートはここで最新化してから読む（タスク数は数百件以下なので毎回評価してよい）
  await evaluateAlerts({ tasks, monthly, creative: creative?.status === 'ok' ? creative.list : null, now }).catch(() => undefined);
  const alerts: AlertItem[] = await listOpenAlerts(actor).catch(() => []);
  const redAlerts = alerts.filter((a) => a.level === 'red');
  const yellowAlerts = alerts.filter((a) => a.level === 'yellow');

  // 機密（粗利）は管理職以上のみ。API レベルで値を落とす
  const profit = redactConfidential({ grossProfit: profitRaw.value, note: profitRaw.note }, actor.level, ['grossProfit']);
  const canSeeProfit = canSeeConfidential(actor.level);

  const targetLabel = targets.isDefault ? '仮置き' : '目標・予実管理の登録値';
  const tiles: KpiTile[] = [];

  if (monthly) {
    const dayLabel = monthly.latestDate ? `${Number(monthly.latestDate.slice(5, 7))}/${Number(monthly.latestDate.slice(8, 10))}` : '—';
    const todayJudge: Judgment =
      monthly.todaySales == null
        ? 'na'
        : monthly.todayTarget && monthly.todayTarget > 0
          ? // business.md §6 日次判定: 売上÷日次目標 ≥1.0 🟢 / ≥0.7 🟡 / 未満 🔴
            monthly.todaySales / monthly.todayTarget >= 1
            ? 'ok'
            : monthly.todaySales / monthly.todayTarget >= 0.7
              ? 'warn'
              : 'danger'
          : 'na';
    tiles.push({
      key: 'today_sales',
      label: `本日売上（${dayLabel} 最新日）`,
      value: monthly.todaySales == null ? '未取得' : formatYen(monthly.todaySales),
      sub: monthly.todayByChannel
        ? `楽天 ${formatYen(monthly.todayByChannel.rakuten)} / Amazon ${formatYen(monthly.todayByChannel.amazon)} / 自社 ${formatYen(monthly.todayByChannel.own)}`
        : null,
      judgment: todayJudge,
      reason:
        monthly.todaySales == null
          ? '当月のKPI報告がまだありません'
          : monthly.todayTarget && monthly.todayTarget > 0
            ? `日別目標 ${formatYen(monthly.todayTarget)} に対し ${((monthly.todaySales / monthly.todayTarget) * 100).toFixed(0)}%`
            : '日別目標が未入力のため判定なし',
      href: null,
    });
    const paceJ = judgePace(monthly.pace);
    tiles.push({
      key: 'month_sales',
      label: '今月売上（累計）',
      value: formatYen(monthly.monthToDate),
      sub: `${monthly.dataDays}日分 / 楽天 ${formatYen(monthly.byChannel.rakuten)}・Amazon ${formatYen(monthly.byChannel.amazon)}・自社 ${formatYen(monthly.byChannel.own)}`,
      judgment: paceJ,
      reason: monthly.pace.kind === 'na' ? monthly.pace.reason : `計画ペース比 ${(monthly.pace.value * 100).toFixed(0)}%`,
      href: null,
    });
    tiles.push({
      key: 'target',
      label: `月間目標 / 達成率（${targetLabel}）`,
      value: pct(monthly.achievementRate),
      sub: `目標 ${formatYen(targets.main)}（ストレッチ ${formatYen(targets.stretch)}）`,
      judgment: paceJ,
      reason:
        monthly.pace.kind === 'na'
          ? monthly.pace.reason
          : `${monthly.elapsedDays}/${monthly.daysInMonth}日経過。計画ペース比 ${(monthly.pace.value * 100).toFixed(0)}%`,
      href: '/targets',
    });
    const reqJ: Judgment =
      monthly.requiredDailyMain.kind === 'na' || monthly.avg7.kind === 'na'
        ? 'na'
        : monthly.avg7.value >= monthly.requiredDailyMain.value
          ? 'ok'
          : monthly.avg7.value >= monthly.requiredDailyMain.value * THRESHOLDS.paceWarn
            ? 'warn'
            : 'danger';
    tiles.push({
      key: 'required_daily',
      label: `必要日販（残り${monthly.remainingDays}日）`,
      value: yen(monthly.requiredDailyMain),
      sub: `ストレッチ ${yen(monthly.requiredDailyStretch)} / 直近${monthly.avg7Days}日平均 ${yen(monthly.avg7)}`,
      judgment: reqJ,
      reason:
        monthly.requiredDailyMain.kind === 'na' || monthly.avg7.kind === 'na'
          ? '算出できません'
          : monthly.avg7.value >= monthly.requiredDailyMain.value
            ? `貯金ペース（+${formatYen(monthly.avg7.value - monthly.requiredDailyMain.value)}/日）`
            : `毎日あと ${formatYen(monthly.requiredDailyMain.value - monthly.avg7.value)} 必要`,
      href: null,
    });
    tiles.push({
      key: 'prev_month',
      label: '前月同期間比',
      value: changeText(monthly.prevSamePeriodChange),
      sub:
        monthly.prevSamePeriod == null
          ? `前月（${monthly.prevSamePeriodDays}日分）のKPI報告がありません`
          : `前月1〜${monthly.elapsedDays}日 ${formatYen(monthly.prevSamePeriod)}（${monthly.prevSamePeriodDays}日分）`,
      judgment:
        monthly.prevSamePeriodChange.kind === 'na' ? 'na' : monthly.prevSamePeriodChange.value >= 0 ? 'ok' : 'warn',
      reason: monthly.prevSamePeriodChange.kind === 'na' ? monthly.prevSamePeriodChange.reason : '前月の同じ日数で比較',
      href: null,
    });
    tiles.push({
      key: 'ad',
      label: '広告費 / 広告費率（今月）',
      value: pct(monthly.adRatio),
      sub: `広告費 ${formatYen(monthly.adTotal)}（Google ${formatYen(monthly.adByMedia.google)}・楽天 ${formatYen(monthly.adByMedia.rakuten)}・Amazon ${formatYen(monthly.adByMedia.amazon)}・Meta ${formatYen(monthly.adByMedia.meta)}）`,
      judgment: judgeAdRatio(monthly.adRatio),
      reason: `目標${THRESHOLDS.adRatioOkMax}%以下・許容${THRESHOLDS.adRatioWarnMax}%以下`,
      href: '/ads',
    });
  } else {
    const reason = kpiRes.status === 'unavailable' ? kpiRes.reason : '未取得';
    for (const [key, label] of [
      ['today_sales', '本日売上'],
      ['month_sales', '今月売上（累計）'],
      ['target', `月間目標 / 達成率（${targetLabel}）`],
      ['required_daily', '必要日販'],
      ['prev_month', '前月同期間比'],
      ['ad', '広告費 / 広告費率（今月）'],
    ] as const) {
      tiles.push({
        key,
        label,
        value: '未接続',
        sub: key === 'target' ? `目標 ${formatYen(targets.main)}（ストレッチ ${formatYen(targets.stretch)}）` : null,
        judgment: 'na',
        reason,
        href: key === 'target' ? '/targets' : '/integrations',
      });
    }
  }

  tiles.push({
    key: 'gross_profit',
    label: '粗利（暫定）',
    value: !canSeeProfit ? '非表示' : profit.grossProfit == null ? profit.note : formatYen(profit.grossProfit),
    sub: !canSeeProfit ? '管理職以上のみ閲覧できます' : profit.grossProfit == null ? null : profit.note,
    judgment: 'na',
    reason: !canSeeProfit ? '機密項目' : profit.grossProfit == null ? '原価データ連携後に表示' : '判定基準は未設定',
    href: canSeeProfit ? '/sales' : null,
  });
  tiles.push({
    key: 'inventory',
    label: '在庫金額',
    value: '未取得',
    sub: null,
    judgment: 'na',
    reason: '在庫報告(35)は未連携',
    href: '/inventory',
  });
  tiles.push({
    key: 'open_tasks',
    label: '未完了タスク',
    value: `${stats.open}件`,
    sub: `本日期限 ${stats.dueToday}件 / P1 ${stats.p1Open}件 / 確認待ち滞留 ${waitingStale.length}件`,
    judgment: judgeCount(waitingStale.length, THRESHOLDS.waitingWarnAt, THRESHOLDS.waitingDangerAt),
    reason:
      waitingStale.length === 0
        ? '確認待ちの滞留なし'
        : `「確認待ち」のまま${THRESHOLDS.waitingStaleDays}日以上が${waitingStale.length}件`,
    href: '/tasks',
  });
  tiles.push({
    key: 'overdue',
    label: '期限超過タスク',
    value: `${stats.overdue}件`,
    sub: taskList.source === 'kintone' ? `Kintoneタスク管理(${taskList.appId})` : 'ローカルDB（Kintone未接続）',
    judgment: judgeCount(stats.overdue, THRESHOLDS.overdueWarnAt, THRESHOLDS.overdueDangerAt),
    reason: stats.overdue === 0 ? '期限超過なし' : `${THRESHOLDS.overdueDangerAt}件以上で🔴`,
    href: '/tasks?filter=overdue',
  });
  tiles.push({
    key: 'alerts',
    label: '重要アラート',
    value: `${redAlerts.length}件`,
    sub: `注意 ${yellowAlerts.length}件`,
    judgment: judgeCount(redAlerts.length, THRESHOLDS.redAlertWarnAt, THRESHOLDS.redAlertDangerAt),
    reason: redAlerts.length === 0 ? '🔴なし' : redAlerts[0].title,
    href: '/pro/alerts',
  });

  // 今日の判断事項: KPI系の🔴 → 期限超過のP1 → その他の🔴（最大8件）
  const decisions: Decision[] = [];
  const seen = new Set<string>();
  const pushAlert = (a: AlertItem) => {
    if (decisions.length >= 8 || seen.has(`a:${a.id}`)) return;
    if (a.entityType === 'task' && seen.has(`t:${a.entityId}`)) return;
    seen.add(`a:${a.id}`);
    if (a.entityType === 'task') seen.add(`t:${a.entityId}`);
    decisions.push({ kind: 'alert', level: a.level, title: a.title, detail: a.detail ?? '', href: a.href });
  };
  for (const a of redAlerts.filter((a) => a.entityType === 'kpi')) pushAlert(a);
  for (const t of tasks) {
    if (decisions.length >= 8) break;
    if (t.status === '完了' || t.priority !== 'P1' || !t.due || t.due >= today) continue;
    if (seen.has(`t:${t.id}`)) continue;
    seen.add(`t:${t.id}`);
    decisions.push({
      kind: 'task',
      level: 'red',
      title: `P1 期限超過: ${t.title}`,
      detail: `${t.team || '—'} / ${t.assignee || '未割当'} / 期限 ${t.due}`,
      href: taskHref(t),
    });
  }
  for (const a of redAlerts) pushAlert(a);

  const teams: TeamCard[] = TEAM_DEFS.map((d) => {
    if (d.kintoneLabels.length === 0) {
      return { code: d.code, name: d.name, leader: d.leader, open: null, overdue: null, waiting: null, href: `/pro/teams/${d.code}` };
    }
    let open = 0;
    let overdue = 0;
    let waiting = 0;
    for (const t of tasks) {
      if (!d.kintoneLabels.includes(t.team) || t.status === '完了') continue;
      open++;
      if (t.due && t.due < today) overdue++;
      if (t.status === '確認待ち') waiting++;
    }
    return { code: d.code, name: d.name, leader: d.leader, open, overdue, waiting, href: `/pro/teams/${d.code}` };
  });

  return {
    month,
    today,
    kpi:
      kpiRes.status === 'ok'
        ? { status: 'ok', appId: kpiRes.appId, latestDate: monthly?.latestDate ?? null, dataDays: monthly?.dataDays ?? 0, source: kpiRes.source, cachedAt: kpiRes.cachedAt ?? null }
        : { status: 'unavailable', appId: kpiRes.appId, reason: kpiRes.reason },
    monthly,
    tasks: { source: taskList.source, notice: taskList.notice, open: stats.open, overdue: stats.overdue, waitingStale: waitingStale.length },
    alerts: { red: redAlerts.length, yellow: yellowAlerts.length },
    tiles,
    decisions,
    teams,
    canSeeProfit,
  };
}

/** Kintone チーム表記 → 部署コード（アラートの teamCode 用） */
export function teamCodeOfLabel(label: string): string | null {
  return teamByKintoneLabel(label)?.code ?? null;
}
