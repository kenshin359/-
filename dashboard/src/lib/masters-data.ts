// マスター件数のデータ取得（各マスターテーブル → src/lib/metrics/masters.ts）。
import { prisma } from './prisma';
import { countMasters, type MasterCount } from './metrics/masters';

export async function getMasterCounts(): Promise<MasterCount[]> {
  const [channel, media, warehouse, supplier, series, sku, skuCost, user] = await Promise.all([
    prisma.channel.findMany({ select: { code: true, name: true } }),
    prisma.media.findMany({ select: { code: true, name: true } }),
    prisma.warehouse.findMany({ select: { code: true, name: true } }),
    prisma.supplier.findMany({ select: { code: true, name: true } }),
    prisma.productSeries.findMany({ select: { code: true, name: true } }),
    prisma.sku.findMany({ select: { code: true, name: true } }),
    prisma.skuCost.findMany({ select: { sku: { select: { code: true, name: true } } } }),
    prisma.user.findMany({ select: { email: true, name: true } }),
  ]);
  return [
    countMasters('channel', channel),
    countMasters('media', media),
    countMasters('warehouse', warehouse),
    countMasters('supplier', supplier),
    countMasters('series', series),
    countMasters('sku', sku),
    // 原価は紐づく SKU がデモかどうかで判定
    countMasters('skuCost', skuCost.map((c) => c.sku)),
    countMasters('user', user),
  ];
}
