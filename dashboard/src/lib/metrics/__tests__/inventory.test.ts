import { describe, expect, it } from 'vitest';
import { buildStockTable, judgeStock, LOW_STOCK_THRESHOLD } from '../inventory';

const WH = [
  { code: 'fba', name: 'FBA' },
  { code: 'cs', name: 'CS' },
];

describe('在庫 SKU×倉庫（docs/business.md §6「在庫」・G-9）', () => {
  it('在庫数は入出庫 qty の合計（in 正・out 負）で、倉庫別と合計が出る', () => {
    const t = buildStockTable(
      [
        { skuCode: 'SC-M-BK', skuName: 'スーツケースM 黒', seriesName: 'スーツケースM', warehouseCode: 'fba', qty: 50, date: '2026-09-01' },
        { skuCode: 'SC-M-BK', skuName: 'スーツケースM 黒', seriesName: 'スーツケースM', warehouseCode: 'fba', qty: -20, date: '2026-09-10' },
        { skuCode: 'SC-M-BK', skuName: 'スーツケースM 黒', seriesName: 'スーツケースM', warehouseCode: 'cs', qty: 30, date: '2026-09-05' },
      ],
      WH,
    );
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].byWarehouse).toEqual({ fba: 30, cs: 30 });
    expect(t.lines[0].total).toBe(60);
    expect(t.lines[0].flags).toEqual([]);
    expect(t.totals).toEqual({ fba: 30, cs: 30 });
    expect(t.grandTotal).toBe(60);
    expect(t.lastMoveDate).toBe('2026-09-10');
    expect(t.lines[0].lastMoveDate).toBe('2026-09-10');
  });

  it('判定: 欠品=両方0、FBA切れ=FBA 0・CS>0、CS切れ=CS 0・FBA>0、残りわずか=合計10個以下', () => {
    expect(judgeStock({ fba: 0, cs: 0 }, WH)).toEqual(['欠品']);
    expect(judgeStock({ fba: 0, cs: 25 }, WH)).toEqual(['FBA切れ']);
    expect(judgeStock({ fba: 25, cs: 0 }, WH)).toEqual(['CS切れ']);
    expect(judgeStock({ fba: 5, cs: 5 }, WH)).toEqual(['残りわずか']);
    expect(judgeStock({ fba: 0, cs: LOW_STOCK_THRESHOLD }, WH)).toEqual(['FBA切れ', '残りわずか']);
    expect(judgeStock({ fba: 6, cs: 5 }, WH)).toEqual([]);
    expect(judgeStock({ fba: -1, cs: 8 }, WH)).toEqual(['FBA切れ', '残りわずか', 'マイナス在庫']);
  });

  it('倉庫が fba/cs でない（例: main のみ）ときは FBA切れ・CS切れを判定しない', () => {
    const one = [{ code: 'main', name: 'メイン倉庫' }];
    expect(judgeStock({ main: 0 }, one)).toEqual(['欠品']);
    expect(judgeStock({ main: 3 }, one)).toEqual(['残りわずか']);
    expect(judgeStock({ main: 30 }, one)).toEqual([]);
  });

  it('異常のある SKU を先に並べ、異常件数を集計する。動きが無ければ空', () => {
    const t = buildStockTable(
      [
        { skuCode: 'B', skuName: 'B', seriesName: 'S', warehouseCode: 'fba', qty: 40, date: '2026-09-01' },
        { skuCode: 'B', skuName: 'B', seriesName: 'S', warehouseCode: 'cs', qty: 40, date: '2026-09-01' },
        { skuCode: 'A', skuName: 'A', seriesName: 'S', warehouseCode: 'fba', qty: 10, date: '2026-09-01' },
        { skuCode: 'A', skuName: 'A', seriesName: 'S', warehouseCode: 'fba', qty: -10, date: '2026-09-02' },
        { skuCode: 'A', skuName: 'A', seriesName: 'S', warehouseCode: 'cs', qty: 4, date: '2026-09-02' },
      ],
      WH,
    );
    expect(t.lines.map((l) => l.skuCode)).toEqual(['A', 'B']);
    expect(t.lines[0].flags).toEqual(['FBA切れ', '残りわずか']);
    expect(t.flagCounts).toEqual({ 欠品: 0, 残りわずか: 1, FBA切れ: 1, CS切れ: 0, マイナス在庫: 0 });
    const empty = buildStockTable([], WH);
    expect(empty.lines).toEqual([]);
    expect(empty.grandTotal).toBe(0);
    expect(empty.lastMoveDate).toBeNull();
  });
});
