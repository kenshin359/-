// ダッシュボード用のデータ取得。集計は必ず src/lib/metrics を通す。
import { prisma } from './prisma';
import { computePeriodMetrics, forecastMonthEnd, changeRate } from './metrics/compute';
import type { PeriodMetrics, MetricValue } from './metrics/types';
import { jstDateKey } from './metrics/format';

export interface DashboardData {
  demoMode: boolean;
  lastImportAt: string | null;
  periodLabel: string;
  compareLabel: string;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  salesChange: MetricValue;
  channelSales: { name: string; sales: number }[];
  dailySeries: { day: string; current: number | null; previous: number | null }[];
  monthTarget: number | null;
  monthToDate: number;
  forecast: MetricValue;
  forecastDays: number;
  adBudget: number | null;
  monthAdSpend: number;
  sparkline: {
    sessions: { date: string; v: number }[];
    cvr: { date: string; v: number }[];
    aov: { date: string; v: number }[];
    orders: { date: string; v: number }[];
  };
  topSkus: { name: string; qty: number; sales: number }[];
  pipeline: { status: string; count: number }[];
  tasks: { id: string; title: string; priority: string; status: string; dueDate: string | null }[];
  proposals: {
    id: string;
    title: string;
    priority: number;
    facts: Record<string, string>;
    action: string | null;
    effectNote: string | null;
  }[];
  alerts: string[];
}

async function loadPeriod(demo: boolean, from: Date, to: Date) {
  const orders = await prisma.order.findMany({
    where: { demo, shipDate: { gte: from, lt: to } },
    include: { items: true, channel: true, refunds: true },
  });
  const ads = await prisma.adDaily.findMany({
    where: { demo, date: { gte: from, lt: to } },
    include: { media: true },
  });
  const access = await prisma.accessDaily.findMany({
    where: { demo, date: { gte: from, lt: to } },
    include: { channel: true },
  });
  const costs = await prisma.cost.findMany({ where: { demo, date: { gte: from, lt: to } } });
  return { orders, ads, access, costs };
}

type Loaded = Awaited<ReturnType<typeof loadPeriod>>;

function toComputeInput(rows: Loaded) {
  return {
    orders: rows.orders.map((o) => ({
      orderId: o.id,
      channelCode: o.channel.code,
      date: jstDateKey(o.shipDate ?? o.orderDate),
      status: o.status as 'ordered' | 'shipped' | 'cancelled',
      shippingRevenue: o.shippingRevenue,
      discount: o.discount,
    })),
    items: rows.orders.flatMap((o) =>
      o.items.map((i) => ({
        orderId: o.id,
        skuCode: i.skuId,
        qty: i.qty,
        unitPrice: i.unitPrice,
        costAtSale: i.costAtSale,
      })),
    ),
    refunds: rows.orders.flatMap((o) =>
      o.refunds.map((r) => ({ orderId: o.id, date: jstDateKey(r.refundDate), amount: r.amount })),
    ),
    ads: rows.ads.map((a) => ({
      date: jstDateKey(a.date),
      mediaCode: a.media.code,
      campaign: a.campaign,
      spend: a.spend,
      impressions: a.impressions,
      clicks: a.clicks,
      mediaCv: a.mediaCv,
      attributedRevenue: a.attributedRevenue,
    })),
    access:
      rows.access.length === 0
        ? null
        : rows.access.map((a) => ({
            date: jstDateKey(a.date),
            channelCode: a.channel.code,
            sessions: a.sessions,
          })),
    costs: rows.costs.map((c) => ({
      date: jstDateKey(c.date),
      costType: c.costType as 'commission' | 'shipping' | 'other_variable',
      amount: c.amount,
      scope: c.scope,
      scopeCode: c.scopeCode,
    })),
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  // 実データ（demo=false）が1件でもあれば実データ、無ければデモ表示（バッジ表示）
  const realCount = await prisma.order.count({ where: { demo: false } });
  const demoMode = realCount === 0;

  const latest = await prisma.order.findFirst({
    where: { demo: demoMode },
    orderBy: { shipDate: 'desc' },
    select: { shipDate: true, orderDate: true },
  });
  const anchor = latest?.shipDate ?? latest?.orderDate ?? new Date();
  // 期間 = データ最終日を含む直近7日、比較 = その前7日
  const to = new Date(anchor.getTime() + 86400000);
  const from = new Date(to.getTime() - 7 * 86400000);
  const prevTo = from;
  const prevFrom = new Date(prevTo.getTime() - 7 * 86400000);

  const [curRows, prevRows] = await Promise.all([
    loadPeriod(demoMode, from, to),
    loadPeriod(demoMode, prevFrom, prevTo),
  ]);
  const current = computePeriodMetrics(toComputeInput(curRows));
  const previous = computePeriodMetrics(toComputeInput(prevRows));

  // チャネル別売上（明細から集計）
  const chMap = new Map<string, number>();
  for (const o of curRows.orders) {
    if (o.status === 'cancelled') continue;
    const s = o.items.reduce((acc, i) => acc + i.qty * i.unitPrice, 0);
    chMap.set(o.channel.name, (chMap.get(o.channel.name) ?? 0) + s);
  }
  const channelSales = [...chMap.entries()]
    .map(([name, sales]) => ({ name, sales }))
    .sort((a, b) => b.sales - a.sales);

  // 日別推移（今期7日 vs 前期7日、曜日ならぬ経過日で対応付け）
  const dailyOf = (rows: Loaded, f: Date) => {
    const arr = new Array<number>(7).fill(0);
    for (const o of rows.orders) {
      if (o.status === 'cancelled') continue;
      const d = Math.floor(((o.shipDate ?? o.orderDate).getTime() - f.getTime()) / 86400000);
      if (d >= 0 && d < 7)
        arr[d] += o.items.reduce((acc, i) => acc + i.qty * i.unitPrice, 0);
    }
    return arr;
  };
  const curDaily = dailyOf(curRows, from);
  const prevDaily = dailyOf(prevRows, prevFrom);
  const dailySeries = curDaily.map((v, idx) => ({
    day: jstDateKey(new Date(from.getTime() + idx * 86400000)).slice(5),
    current: v,
    previous: prevDaily[idx] ?? null,
  }));

  // 当月（アンカー日の属する月）実績と着地予測
  const anchorKey = jstDateKey(anchor);
  const monthPrefix = anchorKey.slice(0, 7);
  const monthStart = new Date(`${monthPrefix}-01T00:00:00+09:00`);
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const daysInMonth = Math.round((nextMonth.getTime() - monthStart.getTime()) / 86400000);
  const monthRows = await loadPeriod(demoMode, monthStart, nextMonth);
  const dailyNet = new Map<string, number>();
  for (const o of monthRows.orders) {
    if (o.status === 'cancelled') continue;
    const k = jstDateKey(o.shipDate ?? o.orderDate);
    const s = o.items.reduce((acc, i) => acc + i.qty * i.unitPrice, 0);
    dailyNet.set(k, (dailyNet.get(k) ?? 0) + s);
  }
  const monthToDate = [...dailyNet.values()].reduce((a, b) => a + b, 0);
  const forecast = forecastMonthEnd(dailyNet, daysInMonth);
  const monthAdSpend = monthRows.ads.reduce((s, a) => s + a.spend, 0);

  const targets = await prisma.target.findMany({
    where: { month: monthPrefix, scope: 'all', scopeCode: 'all' },
  });
  const monthTarget = targets.find((t) => t.metric === 'sales')?.amount ?? null;
  const adBudget = targets.find((t) => t.metric === 'ad_budget')?.amount ?? null;

  // スパークライン（直近14日・日別）
  const sparkFrom = new Date(to.getTime() - 14 * 86400000);
  const sparkRows = await loadPeriod(demoMode, sparkFrom, to);
  const byDay = new Map<
    string,
    { sales: number; orders: Set<string>; sessions: number }
  >();
  for (let i = 0; i < 14; i++) {
    byDay.set(jstDateKey(new Date(sparkFrom.getTime() + i * 86400000)), {
      sales: 0,
      orders: new Set(),
      sessions: 0,
    });
  }
  for (const o of sparkRows.orders) {
    if (o.status === 'cancelled') continue;
    const k = jstDateKey(o.shipDate ?? o.orderDate);
    const e = byDay.get(k);
    if (!e) continue;
    e.sales += o.items.reduce((acc, i) => acc + i.qty * i.unitPrice, 0);
    e.orders.add(o.id);
  }
  for (const a of sparkRows.access) {
    const e = byDay.get(jstDateKey(a.date));
    if (e) e.sessions += a.sessions;
  }
  const spark = [...byDay.entries()];
  const sparkline = {
    sessions: spark.map(([date, e]) => ({ date: date.slice(5), v: e.sessions })),
    cvr: spark.map(([date, e]) => ({
      date: date.slice(5),
      v: e.sessions > 0 ? +( (e.orders.size / e.sessions) * 100).toFixed(2) : 0,
    })),
    aov: spark.map(([date, e]) => ({
      date: date.slice(5),
      v: e.orders.size > 0 ? Math.round(e.sales / e.orders.size) : 0,
    })),
    orders: spark.map(([date, e]) => ({ date: date.slice(5), v: e.orders.size })),
  };

  // 商品別TOP10（期間内・明細から）
  const skuAgg = new Map<string, { qty: number; sales: number }>();
  for (const o of curRows.orders) {
    if (o.status === 'cancelled') continue;
    for (const i of o.items) {
      const e = skuAgg.get(i.skuId) ?? { qty: 0, sales: 0 };
      e.qty += i.qty;
      e.sales += i.qty * i.unitPrice;
      skuAgg.set(i.skuId, e);
    }
  }
  const skuRows = await prisma.sku.findMany({
    where: { id: { in: [...skuAgg.keys()] } },
    select: { id: true, name: true },
  });
  const skuName = new Map(skuRows.map((s) => [s.id, s.name]));
  const topSkus = [...skuAgg.entries()]
    .map(([id, e]) => ({ name: skuName.get(id) ?? id, ...e }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);

  // 仕入れパイプライン（代表4段）
  const poGroups = await prisma.purchaseOrder.groupBy({ by: ['status'], _count: true });
  const stageOrder = ['research', 'quote', 'sample', 'test_sale', 'ordered', 'producing', 'shipped', 'received'];
  const stageJa: Record<string, string> = {
    research: 'リサーチ', quote: '見積', sample: 'サンプル', test_sale: 'テスト販売',
    ordered: '発注済', producing: '生産中', shipped: '輸送中', received: '入庫済',
  };
  const pipeline = stageOrder
    .map((s) => ({
      status: stageJa[s],
      count: poGroups.find((g) => g.status === s)?._count ?? 0,
    }))
    .filter((p) => p.count > 0)
    .slice(0, 4);

  const tasks = (
    await prisma.task.findMany({
      where: { status: { in: ['todo', 'doing', 'waiting'] } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: 6,
    })
  ).map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate ? jstDateKey(t.dueDate) : null,
  }));

  const proposals = (
    await prisma.proposal.findMany({
      where: { status: 'open' },
      orderBy: { priority: 'asc' },
      take: 5,
    })
  ).map((p) => ({
    id: p.id,
    title: p.title,
    priority: p.priority,
    facts: JSON.parse(p.facts) as Record<string, string>,
    action: p.action,
    effectNote: p.effectNote,
  }));

  // アラート（ルールベース・根拠付き）
  const alerts: string[] = [];
  if (current.adRatio.kind === 'value' && current.adRatio.value > 20) {
    alerts.push(`広告費率が${current.adRatio.value.toFixed(1)}%で許容20%を超過（直近7日）`);
  }
  if (current.cogsMissingLines > 0) {
    alerts.push(`原価未登録の明細が${current.cogsMissingLines}件（利益は暫定値）`);
  }
  if (current.attributedRevenue === null && current.adSpend > 0) {
    alerts.push('一部媒体の帰属売上が未取得のためROASは表示できません');
  }

  const lastBatch = await prisma.importBatch.findFirst({ orderBy: { createdAt: 'desc' } });

  return {
    demoMode,
    lastImportAt: lastBatch ? lastBatch.createdAt.toISOString() : null,
    periodLabel: `${jstDateKey(from)} 〜 ${jstDateKey(new Date(to.getTime() - 86400000))}`,
    compareLabel: `${jstDateKey(prevFrom)} 〜 ${jstDateKey(new Date(prevTo.getTime() - 86400000))}`,
    current,
    previous,
    salesChange: changeRate(current.netSales, previous.netSales),
    channelSales,
    dailySeries,
    monthTarget,
    monthToDate,
    forecast,
    forecastDays: dailyNet.size,
    adBudget,
    monthAdSpend,
    sparkline,
    topSkus,
    pipeline,
    tasks,
    proposals,
    alerts,
  };
}
