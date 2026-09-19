// 商品別×チャネル別売上のデータ取得（ProductSalesDaily → src/lib/metrics/product-sales.ts）。
// 数字は Kintone 売上明細(29) 由来の取込値のみ。demo データは存在しない（取込専用テーブル）。
import { prisma } from './prisma';
import { buildProductMatrix, productDailySeries, type ProductSalesRow } from './metrics/product-sales';

export async function getProductSalesMonth(month: string) {
  const rows: ProductSalesRow[] = await prisma.productSalesDaily.findMany({
    where: { date: { startsWith: month } },
    select: { date: true, channel: true, rawChannel: true, product: true, units: true, amount: true },
    orderBy: { date: 'asc' },
  });
  const last = await prisma.productSalesDaily.findFirst({ where: { date: { startsWith: month } }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } });
  return { rows, matrix: buildProductMatrix(rows), lastUpdated: last?.updatedAt ?? null };
}

export function getProductSeries(rows: ProductSalesRow[], product: string) {
  return productDailySeries(rows, product);
}

/** データが存在する月（降順）。当月は無くても先頭に含める */
export async function getProductSalesMonths(thisMonth: string): Promise<string[]> {
  const rows = await prisma.productSalesDaily.findMany({ select: { date: true }, distinct: ['date'], orderBy: { date: 'desc' } });
  const set = new Set<string>([thisMonth, ...rows.map((r) => r.date.slice(0, 7))]);
  return [...set].sort().reverse();
}
