// デモ組織データ（demo=true で実データ集計から常に排他）。
// 数値は架空。実在の実績・目標を混ぜない。
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// 乱数は固定シード（再実行しても同じデモデータ）
let seedState = 20260901;
function rand(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

async function main() {
  // ---- ユーザー（3ロール） ----
  const users = [
    { email: 'admin@demo.local', name: '管理者デモ', role: 'admin', pw: 'admin1234' },
    { email: 'editor@demo.local', name: '編集者デモ', role: 'editor', pw: 'editor1234' },
    { email: 'viewer@demo.local', name: '閲覧者デモ', role: 'viewer', pw: 'viewer1234' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: await bcrypt.hash(u.pw, 10),
      },
    });
  }

  // ---- マスター ----
  const channels = [
    { code: 'rakuten', name: '楽天' },
    { code: 'amazon', name: 'Amazon' },
    { code: 'own', name: '自社サイト' },
  ];
  for (const c of channels) {
    await prisma.channel.upsert({ where: { code: c.code }, update: {}, create: c });
  }
  const media = [
    { code: 'meta_travel', name: 'Metaトラベル' },
    { code: 'meta_catalog', name: 'Metaカタログ' },
    { code: 'rpp', name: '楽天RPP' },
    { code: 'amazon_ads', name: 'Amazon広告' },
    { code: 'google', name: 'Google' },
  ];
  for (const m of media) {
    await prisma.media.upsert({ where: { code: m.code }, update: {}, create: m });
  }
  await prisma.warehouse.upsert({
    where: { code: 'main' },
    update: {},
    create: { code: 'main', name: 'メイン倉庫' },
  });
  await prisma.supplier.upsert({
    where: { code: 'sup-a' },
    update: {},
    create: { code: 'sup-a', name: 'デモ仕入先A' },
  });

  const seriesDefs = [
    { code: 'demo-sc-s', name: 'デモスーツケースS', price: 29800, cost: 9800 },
    { code: 'demo-sc-m', name: 'デモスーツケースM', price: 36800, cost: 12500 },
    { code: 'demo-sc-l', name: 'デモスーツケースL', price: 44800, cost: 15800 },
    { code: 'demo-alu', name: 'デモアルミ', price: 42800, cost: 16000 },
    { code: 'demo-acc', name: 'デモアクセサリ', price: 3980, cost: 1200 },
  ];
  const skuIds: { id: string; price: number; cost: number }[] = [];
  for (const s of seriesDefs) {
    const series = await prisma.productSeries.upsert({
      where: { code: s.code },
      update: {},
      create: { code: s.code, name: s.name },
    });
    for (const color of ['BK', 'SV']) {
      const code = `${s.code}-${color}`;
      const sku = await prisma.sku.upsert({
        where: { code },
        update: {},
        create: { code, seriesId: series.id, size: null, color, name: `${s.name} ${color}` },
      });
      await prisma.skuCost.create({
        data: { skuId: sku.id, unitCost: s.cost, validFrom: new Date('2026-01-01T00:00:00Z') },
      }).catch(() => undefined);
      skuIds.push({ id: sku.id, price: s.price, cost: s.cost });
    }
  }

  const chRows = await prisma.channel.findMany();
  const mediaRows = await prisma.media.findMany();
  const chByCode = new Map(chRows.map((c) => [c.code, c.id]));
  const mediaByCode = new Map(mediaRows.map((m) => [m.code, m.id]));

  // ---- 30日分の注文・広告・アクセス・コスト（2026-08-16〜09-14, demo=true） ----
  await prisma.orderItem.deleteMany({ where: { order: { demo: true } } });
  await prisma.order.deleteMany({ where: { demo: true } });
  await prisma.adDaily.deleteMany({ where: { demo: true } });
  await prisma.accessDaily.deleteMany({ where: { demo: true } });
  await prisma.cost.deleteMany({ where: { demo: true } });

  const start = new Date('2026-08-16T00:00:00Z');
  let orderSeq = 1;
  for (let d = 0; d < 30; d++) {
    const date = new Date(start.getTime() + d * 86400000);
    for (const ch of channels) {
      const nOrders = randInt(ch.code === 'rakuten' ? 8 : 4, ch.code === 'rakuten' ? 16 : 10);
      let chSales = 0;
      for (let i = 0; i < nOrders; i++) {
        const sku = skuIds[randInt(0, skuIds.length - 1)];
        const qty = rand() < 0.9 ? 1 : 2;
        const order = await prisma.order.create({
          data: {
            demo: true,
            channelId: chByCode.get(ch.code)!,
            orderNo: `DEMO-${ch.code}-${orderSeq++}`,
            orderDate: date,
            shipDate: date,
            status: 'shipped',
            shippingRevenue: 0,
            discount: 0,
          },
        });
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            lineNo: 1,
            skuId: sku.id,
            qty,
            unitPrice: sku.price,
            costAtSale: sku.cost,
          },
        });
        chSales += qty * sku.price;
      }
      await prisma.accessDaily.create({
        data: {
          demo: true,
          date,
          channelId: chByCode.get(ch.code)!,
          sessions: nOrders * randInt(45, 70),
        },
      });
      // 手数料10%・配送費 一律800円/注文（デモ用の仮定値）
      await prisma.cost.createMany({
        data: [
          {
            demo: true,
            date,
            scope: 'channel',
            scopeCode: ch.code,
            costType: 'commission',
            amount: Math.round(chSales * 0.1),
            isEstimate: true,
          },
          {
            demo: true,
            date,
            scope: 'channel',
            scopeCode: ch.code,
            costType: 'shipping',
            amount: nOrders * 800,
            isEstimate: true,
          },
        ],
      });
    }
    for (const m of media) {
      const spend = randInt(20000, 90000);
      await prisma.adDaily.create({
        data: {
          demo: true,
          date,
          mediaId: mediaByCode.get(m.code)!,
          campaign: 'デモCP',
          spend,
          impressions: spend * randInt(8, 15),
          clicks: Math.round(spend / randInt(60, 140)),
          mediaCv: randInt(2, 12),
          // meta系は帰属売上未取得のデモ（ROAS「未取得」表示の確認用）
          attributedRevenue: m.code.startsWith('meta') ? null : spend * randInt(3, 8),
        },
      });
    }
  }

  // ---- 目標・タスク・提案・仕入れ ----
  await prisma.target.upsert({
    where: {
      month_scope_scopeCode_metric: {
        month: '2026-09',
        scope: 'all',
        scopeCode: 'all',
        metric: 'sales',
      },
    },
    update: {},
    create: { month: '2026-09', scope: 'all', scopeCode: 'all', metric: 'sales', amount: 30000000 },
  });
  await prisma.target.upsert({
    where: {
      month_scope_scopeCode_metric: {
        month: '2026-09',
        scope: 'all',
        scopeCode: 'all',
        metric: 'ad_budget',
      },
    },
    update: {},
    create: {
      month: '2026-09',
      scope: 'all',
      scopeCode: 'all',
      metric: 'ad_budget',
      amount: 4500000,
    },
  });

  const admin = await prisma.user.findUnique({ where: { email: 'admin@demo.local' } });
  if ((await prisma.task.count()) === 0) {
    await prisma.task.createMany({
      data: [
        { title: '（デモ）9月セールのバナー差し替え', priority: 'high', status: 'todo', assigneeId: admin?.id },
        { title: '（デモ）Sサイズ再入荷の在庫登録', priority: 'mid', status: 'doing' },
        { title: '（デモ）広告レポートの週次確認', priority: 'low', status: 'todo' },
      ],
    });
  }
  if ((await prisma.proposal.count()) === 0) {
    await prisma.proposal.create({
      data: {
        source: 'rule',
        ruleCode: 'AD_RATIO_HIGH',
        title: '（デモ）広告費率が閾値20%を超過',
        priority: 1,
        targetLabel: '全社',
        facts: JSON.stringify({ 広告費率: '21.4%', 閾値: '20%', 期間: '直近7日' }),
        period: '直近7日',
        hypothesis: '特定媒体のCPC上昇が要因の可能性',
        action: '媒体別の費用対効果を確認し、低効率キャンペーンの入札を調整',
        effectNote: '予測: 広告費率2pt改善で月間の貢献利益+約12万円（式=月商×2%、前提=売上維持）',
      },
    });
  }
  if ((await prisma.purchaseOrder.count()) === 0) {
    const sup = await prisma.supplier.findUnique({ where: { code: 'sup-a' } });
    const statuses = ['research', 'quote', 'ordered', 'shipped'];
    for (let i = 0; i < statuses.length; i++) {
      await prisma.purchaseOrder.create({
        data: {
          demo: true,
          poNo: `DEMO-PO-${i + 1}`,
          supplierId: sup!.id,
          status: statuses[i],
          etaDate: new Date(Date.now() + (i + 2) * 7 * 86400000),
          memo: 'デモ案件',
          lines: {
            create: { skuId: skuIds[i].id, qty: randInt(100, 500), unitCost: skuIds[i].cost },
          },
        },
      });
    }
  }

  console.log('seed done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
