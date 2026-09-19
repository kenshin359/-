// 在庫のデータ取得（InventoryMove／Sku／Warehouse → src/lib/metrics/inventory.ts）。
// demo=true の入出庫は常に除外。実データが無い間は画面が「未接続」を出す（成功と偽らない）。
import { prisma } from './prisma';
import { buildStockTable, type StockMoveRow, type WarehouseRef } from './metrics/inventory';
import { jstDateKey } from './metrics/format';
import { isDemoMaster } from './metrics/masters';

export async function getInventoryOverview() {
  const [moves, warehouses, demoMoves, skuTotal] = await Promise.all([
    prisma.inventoryMove.findMany({
      where: { demo: false },
      select: { date: true, qty: true, warehouse: { select: { code: true } }, sku: { select: { code: true, name: true, series: { select: { name: true } } } } },
      orderBy: { date: 'asc' },
    }),
    prisma.warehouse.findMany({ select: { code: true, name: true }, orderBy: { code: 'asc' } }),
    prisma.inventoryMove.count({ where: { demo: true } }),
    prisma.sku.count(),
  ]);

  const rows: StockMoveRow[] = moves.map((m) => ({
    skuCode: m.sku.code,
    skuName: m.sku.name,
    seriesName: m.sku.series.name,
    warehouseCode: m.warehouse.code,
    qty: m.qty,
    date: jstDateKey(m.date),
  }));
  const whRefs: WarehouseRef[] = warehouses.map((w) => ({ code: w.code, name: w.name }));
  const realWarehouses = whRefs.filter((w) => !isDemoMaster('warehouse', w));

  return {
    table: buildStockTable(rows, whRefs),
    moveCount: rows.length,
    demoMoveCount: demoMoves,
    warehouses: whRefs,
    realWarehouses,
    skuTotal,
  };
}
