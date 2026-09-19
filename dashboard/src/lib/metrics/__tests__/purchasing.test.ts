import { describe, expect, it } from 'vitest';
import { lineAmountJpy, PO_STAGES, poAmountJpy, summarizePurchaseOrders, type PoRow } from '../purchasing';

const line = (over: Partial<PoRow['lines'][number]> = {}) => ({
  skuCode: 'SC-M-BK',
  skuName: 'スーツケースM 黒',
  qty: 100,
  unitCost: 12000,
  currency: 'JPY',
  fxRate: null,
  received: false,
  ...over,
});

const po = (over: Partial<PoRow> = {}): PoRow => ({
  poNo: 'PO-1',
  supplierName: '仕入先A',
  status: 'ordered',
  assignee: null,
  etaDate: null,
  memo: null,
  lines: [line()],
  ...over,
});

describe('仕入れ案件の集計（prisma/schema.prisma の status 8段＋archived）', () => {
  it('明細の円換算: JPY は数量×単価、外貨はレート換算、レート未設定は換算不可', () => {
    expect(lineAmountJpy(line())).toEqual({ kind: 'value', value: 1_200_000 });
    expect(lineAmountJpy(line({ currency: 'USD', unitCost: 80, fxRate: 150 }))).toEqual({ kind: 'value', value: 1_200_000 });
    const na = lineAmountJpy(line({ currency: 'CNY', fxRate: null }));
    expect(na.kind).toBe('na');
    if (na.kind === 'na') expect(na.reason).toContain('CNY');
    // 1行でも換算不可なら案件全体も換算不可
    expect(poAmountJpy(po({ lines: [line(), line({ currency: 'CNY', fxRate: null })] })).kind).toBe('na');
  });

  it('段階別件数は9段すべて（0件も）出し、定義外 status は別カウント', () => {
    const s = summarizePurchaseOrders([po({ status: 'research' }), po({ poNo: 'PO-2', status: 'research' }), po({ poNo: 'PO-3', status: 'shipped' }), po({ poNo: 'PO-9', status: 'mystery' })], '2026-09-19');
    expect(s.byStage.map((b) => b.status)).toEqual([...PO_STAGES]);
    expect(s.byStage.find((b) => b.status === 'research')?.count).toBe(2);
    expect(s.byStage.find((b) => b.status === 'shipped')?.count).toBe(1);
    expect(s.byStage.find((b) => b.status === 'ordered')?.count).toBe(0);
    expect(s.unknownStatus).toBe(1);
  });

  it('進行中（入荷済・アーカイブ以外）の件数・数量・金額を出す', () => {
    const s = summarizePurchaseOrders(
      [po({ status: 'ordered' }), po({ poNo: 'PO-2', status: 'received', lines: [line({ qty: 999 })] }), po({ poNo: 'PO-3', status: 'archived' }), po({ poNo: 'PO-4', status: 'quote', lines: [line({ qty: 50, unitCost: 10000 })] })],
      '2026-09-19',
    );
    expect(s.activeCount).toBe(2);
    expect(s.activeQty).toBe(150);
    expect(s.activeAmountJpy).toEqual({ kind: 'value', value: 1_700_000 });
  });

  it('入荷予定は日付順に並び、今日より前は遅延として数える', () => {
    const s = summarizePurchaseOrders(
      [
        po({ poNo: 'PO-B', status: 'shipped', etaDate: '2026-09-25' }),
        po({ poNo: 'PO-A', status: 'producing', etaDate: '2026-09-10' }),
        po({ poNo: 'PO-C', status: 'received', etaDate: '2026-09-01' }),
        po({ poNo: 'PO-D', status: 'ordered', etaDate: null }),
      ],
      '2026-09-19',
    );
    expect(s.upcoming.map((u) => u.poNo)).toEqual(['PO-A', 'PO-B']);
    expect(s.upcoming[0].daysLeft).toBe(-9);
    expect(s.upcoming[1].daysLeft).toBe(6);
    expect(s.overdueCount).toBe(1);
    const empty = summarizePurchaseOrders([], '2026-09-19');
    expect(empty.activeCount).toBe(0);
    expect(empty.activeAmountJpy).toEqual({ kind: 'value', value: 0 });
  });
});
