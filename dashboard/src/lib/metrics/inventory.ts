// 在庫（SKU×倉庫）の集計。純関数のみ（DB取得は src/lib/inventory-data.ts）。
// 在庫数 = InventoryMove.qty の合計（in は正・out は負で保存: prisma/schema.prisma）。
// 判定基準は docs/business.md §6「在庫」: 残りわずか=10個以下、欠品=両方0、FBA切れ（Amazon 0・CS>0）／CS切れ（CS 0・Amazon>0）。
// 倉庫コードは fba / cs を前提（docs/business.md G-9）。他のコードの倉庫は合計にだけ入れ、FBA/CS判定はしない。

export interface StockMoveRow {
  skuCode: string;
  skuName: string;
  seriesName: string;
  warehouseCode: string;
  qty: number;
  /** YYYY-MM-DD（JST） */
  date: string;
}

export interface WarehouseRef {
  code: string;
  name: string;
}

export type StockFlag = '欠品' | '残りわずか' | 'FBA切れ' | 'CS切れ' | 'マイナス在庫';

export interface StockLine {
  skuCode: string;
  skuName: string;
  seriesName: string;
  byWarehouse: Record<string, number>;
  total: number;
  flags: StockFlag[];
  lastMoveDate: string;
}

export interface StockTable {
  warehouses: WarehouseRef[];
  lines: StockLine[];
  totals: Record<string, number>;
  grandTotal: number;
  flagCounts: Record<StockFlag, number>;
  lastMoveDate: string | null;
}

export const LOW_STOCK_THRESHOLD = 10; // docs/business.md §6
export const FBA_CODE = 'fba';
export const CS_CODE = 'cs';

const FLAG_ORDER: StockFlag[] = ['欠品', 'FBA切れ', 'CS切れ', '残りわずか', 'マイナス在庫'];

/** SKU1行分の判定。fba/cs 以外の倉庫しか無い場合は欠品・残りわずかのみ判定する */
export function judgeStock(byWarehouse: Record<string, number>, warehouses: WarehouseRef[]): StockFlag[] {
  const flags: StockFlag[] = [];
  const codes = warehouses.map((w) => w.code);
  const total = codes.reduce((s, c) => s + (byWarehouse[c] ?? 0), 0);
  const hasFba = codes.includes(FBA_CODE);
  const hasCs = codes.includes(CS_CODE);
  const fba = byWarehouse[FBA_CODE] ?? 0;
  const cs = byWarehouse[CS_CODE] ?? 0;

  if (codes.some((c) => (byWarehouse[c] ?? 0) < 0)) flags.push('マイナス在庫');
  if (total <= 0 && codes.every((c) => (byWarehouse[c] ?? 0) <= 0)) {
    flags.push('欠品');
    return sortFlags(flags);
  }
  if (hasFba && hasCs) {
    if (fba <= 0 && cs > 0) flags.push('FBA切れ');
    if (cs <= 0 && fba > 0) flags.push('CS切れ');
  }
  if (total > 0 && total <= LOW_STOCK_THRESHOLD) flags.push('残りわずか');
  return sortFlags(flags);
}

function sortFlags(f: StockFlag[]): StockFlag[] {
  return [...new Set(f)].sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b));
}

export function buildStockTable(moves: StockMoveRow[], warehouses: WarehouseRef[]): StockTable {
  const wh = [...warehouses].sort((a, b) => a.code.localeCompare(b.code));
  const bySku = new Map<string, StockLine>();
  let lastMoveDate: string | null = null;

  for (const m of moves) {
    let line = bySku.get(m.skuCode);
    if (!line) {
      line = { skuCode: m.skuCode, skuName: m.skuName, seriesName: m.seriesName, byWarehouse: {}, total: 0, flags: [], lastMoveDate: m.date };
      for (const w of wh) line.byWarehouse[w.code] = 0;
      bySku.set(m.skuCode, line);
    }
    line.byWarehouse[m.warehouseCode] = (line.byWarehouse[m.warehouseCode] ?? 0) + m.qty;
    line.total += m.qty;
    if (m.date > line.lastMoveDate) line.lastMoveDate = m.date;
    if (!lastMoveDate || m.date > lastMoveDate) lastMoveDate = m.date;
  }

  const totals: Record<string, number> = {};
  for (const w of wh) totals[w.code] = 0;
  const flagCounts: Record<StockFlag, number> = { 欠品: 0, 残りわずか: 0, FBA切れ: 0, CS切れ: 0, マイナス在庫: 0 };
  let grandTotal = 0;

  const lines = [...bySku.values()].map((l) => {
    l.flags = judgeStock(l.byWarehouse, wh);
    for (const f of l.flags) flagCounts[f] += 1;
    for (const w of wh) totals[w.code] += l.byWarehouse[w.code] ?? 0;
    grandTotal += l.total;
    return l;
  });

  // 異常のある行を先に、あとは SKUコード順
  lines.sort((a, b) => {
    const ra = a.flags.length ? FLAG_ORDER.indexOf(a.flags[0]) : 99;
    const rb = b.flags.length ? FLAG_ORDER.indexOf(b.flags[0]) : 99;
    return ra - rb || a.skuCode.localeCompare(b.skuCode);
  });

  return { warehouses: wh, lines, totals, grandTotal, flagCounts, lastMoveDate };
}
