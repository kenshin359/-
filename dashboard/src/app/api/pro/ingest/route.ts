// 日次KPI（売上・広告費）と合算CPA日次の取込API。
// GitHub Actions（Kintoneの認証情報を持つ側）から呼ぶ。認証は Authorization: Bearer <INGEST_SECRET or CRON_SECRET>。
// 数字はKintone由来のものだけを受け取り、推測値は入れない。同じ日付は上書き（UPSERT）。
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Int = z.number().int().min(0).max(10_000_000_000);

const KpiRow = z.object({
  date: Day,
  salesRakuten: Int.default(0),
  salesAmazon: Int.default(0),
  salesOwn: Int.default(0),
  target: Int.nullable().optional(),
  adGoogle: Int.default(0),
  adRakuten: Int.default(0),
  adAmazon: Int.default(0),
  adMeta: Int.default(0),
  note: z.string().max(200).optional(),
});

const CpaRow = z.object({
  date: Day,
  suitcaseSales: Int.nullable().optional(),
  meta: Int.default(0),
  amazonAds: Int.default(0),
  rpp: Int.default(0),
  google: Int.default(0),
  other: Int.default(0),
  unitsAmazon: Int.default(0),
  unitsRakuten: Int.default(0),
  unitsOwn: Int.default(0),
  note: z.string().max(200).optional(),
});

const ProductRow = z.object({
  date: Day,
  channel: z.string().min(1).max(40), // 正規化済み（Amazon/楽天/自社サイト/その他）
  rawChannel: z.string().max(80).optional(),
  product: z.string().min(1).max(120),
  units: Int.default(0),
  amount: Int.default(0),
});

const Body = z.object({
  source: z.string().max(40).default('ingest'),
  kpiDaily: z.array(KpiRow).max(400).default([]),
  cpaDaily: z.array(CpaRow).max(400).default([]),
  productDaily: z.array(ProductRow).max(20_000).default([]),
});

function authorized(req: Request): boolean {
  const header = req.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const secrets = [process.env.INGEST_SECRET, process.env.CRON_SECRET].map((s) => (s || '').trim()).filter(Boolean);
  if (!given || secrets.length === 0) return false;
  const g = Buffer.from(given);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return b.length === g.length && timingSafeEqual(b, g);
  });
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { source, kpiDaily, cpaDaily, productDaily } = parsed.data;

  let kpi = 0;
  for (const r of kpiDaily) {
    const data = {
      salesRakuten: r.salesRakuten,
      salesAmazon: r.salesAmazon,
      salesOwn: r.salesOwn,
      target: r.target ?? null,
      adGoogle: r.adGoogle,
      adRakuten: r.adRakuten,
      adAmazon: r.adAmazon,
      adMeta: r.adMeta,
      source,
      note: r.note ?? null,
    };
    await prisma.kpiDaily.upsert({ where: { date: r.date }, update: data, create: { date: r.date, ...data } });
    kpi++;
  }
  let cpa = 0;
  for (const r of cpaDaily) {
    const data = {
      suitcaseSales: r.suitcaseSales ?? null,
      meta: r.meta,
      amazonAds: r.amazonAds,
      rpp: r.rpp,
      google: r.google,
      other: r.other,
      unitsAmazon: r.unitsAmazon,
      unitsRakuten: r.unitsRakuten,
      unitsOwn: r.unitsOwn,
      note: r.note ?? null,
      updatedBy: source,
    };
    await prisma.cpaDaily.upsert({ where: { date: r.date }, update: data, create: { date: r.date, ...data } });
    cpa++;
  }
  // 商品別×チャネル別: 同じ日付の分は「その日の全行」を置き換える（Kintone側で明細が減った場合も追随させるため）
  let prod = 0;
  const byDate = new Map<string, typeof productDaily>();
  for (const r of productDaily) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  for (const [date, rows] of byDate) {
    await prisma.$transaction([
      prisma.productSalesDaily.deleteMany({ where: { date } }),
      prisma.productSalesDaily.createMany({
        data: rows.map((r) => ({ date, channel: r.channel, rawChannel: r.rawChannel ?? r.channel, product: r.product, units: r.units, amount: r.amount, source })),
      }),
    ]);
    prod += rows.length;
  }
  await prisma.auditLog.create({ data: { action: 'ingest', detail: `${source}: kpiDaily ${kpi}件 / cpaDaily ${cpa}件 / productDaily ${prod}件` } }).catch(() => undefined);
  return NextResponse.json({ ok: true, kpiDaily: kpi, cpaDaily: cpa, productDaily: prod });
}

export async function GET() {
  // 状態確認（ログイン不要・件数だけ）
  const [n, latest] = await Promise.all([prisma.kpiDaily.count(), prisma.kpiDaily.findFirst({ orderBy: { date: 'desc' }, select: { date: true, updatedAt: true } })]);
  return NextResponse.json({ kpiDaily: n, latest });
}
