// 仕入れ案件のデータ取得（PurchaseOrder／PoLine／Supplier → src/lib/metrics/purchasing.ts）。
// demo=true の案件は常に除外。実データが無い間は画面が「未接続」を出す（成功と偽らない）。
import { prisma } from './prisma';
import { summarizePurchaseOrders, type PoRow } from './metrics/purchasing';
import { jstDateKey } from './metrics/format';
import { isDemoMaster } from './metrics/masters';

export async function getPurchasingOverview(today: string) {
  const [pos, demoCount, suppliers] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { demo: false },
      select: {
        poNo: true,
        status: true,
        assignee: true,
        etaDate: true,
        memo: true,
        supplier: { select: { name: true } },
        lines: { select: { qty: true, unitCost: true, currency: true, fxRate: true, received: true, sku: { select: { code: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.purchaseOrder.count({ where: { demo: true } }),
    prisma.supplier.findMany({ select: { code: true, name: true }, orderBy: { code: 'asc' } }),
  ]);

  const rows: PoRow[] = pos.map((p) => ({
    poNo: p.poNo,
    supplierName: p.supplier.name,
    status: p.status,
    assignee: p.assignee,
    etaDate: p.etaDate ? jstDateKey(p.etaDate) : null,
    memo: p.memo,
    lines: p.lines.map((l) => ({ skuCode: l.sku.code, skuName: l.sku.name, qty: l.qty, unitCost: l.unitCost, currency: l.currency, fxRate: l.fxRate, received: l.received })),
  }));

  return {
    rows,
    summary: summarizePurchaseOrders(rows, today),
    demoCount,
    realSuppliers: suppliers.filter((s) => !isDemoMaster('supplier', s)),
  };
}
