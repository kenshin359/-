// docs/metrics.md「検算用固定データ」。期待値をハードコードした画面ではなく、
// 元データ→計算結果が期待値に一致することを検証する。
import { describe, expect, it } from 'vitest';
import { changeRate, computePeriodMetrics, forecastMonthEnd, safeDiv } from '../compute';
import type { AdRow, CostRow, OrderItemRow, OrderRow } from '../types';

function fixtureInput() {
  // 注文100件 × 1明細 × 単価10,000 = 商品売上1,000,000 / 原価5,000×100=500,000
  const orders: OrderRow[] = [];
  const items: OrderItemRow[] = [];
  for (let i = 1; i <= 100; i++) {
    const id = `ORD-${i}`;
    orders.push({
      orderId: id,
      channelCode: 'rakuten',
      date: '2026-09-01',
      status: 'shipped',
      shippingRevenue: 0,
      discount: 0,
    });
    items.push({ orderId: id, skuCode: '101', qty: 1, unitPrice: 10000, costAtSale: 5000 });
  }
  const ads: AdRow[] = [
    {
      date: '2026-09-01',
      mediaCode: 'rpp',
      campaign: 'demo',
      spend: 100000,
      impressions: null,
      clicks: null,
      mediaCv: null,
      attributedRevenue: 600000,
    },
  ];
  const costs: CostRow[] = [
    { date: '2026-09-01', costType: 'commission', amount: 80000, scope: 'all', scopeCode: 'all' },
    { date: '2026-09-01', costType: 'shipping', amount: 20000, scope: 'all', scopeCode: 'all' },
  ];
  return {
    orders,
    items,
    refunds: [],
    ads,
    access: [{ date: '2026-09-01', channelCode: 'rakuten', sessions: 5000 }],
    costs,
  };
}

describe('検算用固定データ（docs/metrics.md）', () => {
  const m = computePeriodMetrics(fixtureInput());

  it('純売上 1,000,000', () => expect(m.netSales).toBe(1_000_000));
  it('売上総利益 500,000', () => expect(m.grossProfit).toBe(500_000));
  it('貢献利益 300,000', () => expect(m.contributionProfit).toBe(300_000));
  it('貢献利益率 30%', () => {
    expect(m.contributionMargin).toEqual({ kind: 'value', value: 30 });
  });
  it('客単価 10,000', () => expect(m.aov).toEqual({ kind: 'value', value: 10_000 }));
  it('CVR 2%', () => expect(m.cvr).toEqual({ kind: 'value', value: 2 }));
  it('ROAS 6倍', () => expect(m.roas).toEqual({ kind: 'value', value: 6 }));
  it('MER 10倍', () => expect(m.mer).toEqual({ kind: 'value', value: 10 }));
  it('広告費率 10%', () => expect(m.adRatio).toEqual({ kind: 'value', value: 10 }));
});

describe('欠損・ゼロの扱い', () => {
  it('キャンセル注文は売上・注文数から除外', () => {
    const base = fixtureInput();
    base.orders[0] = { ...base.orders[0], status: 'cancelled' };
    const m = computePeriodMetrics(base);
    expect(m.netSales).toBe(990_000);
    expect(m.orderCount).toBe(99);
  });

  it('帰属売上が1媒体でも未取得ならROASは「未取得」（総売上で代用しない）', () => {
    const base = fixtureInput();
    base.ads.push({
      date: '2026-09-01',
      mediaCode: 'meta_travel',
      campaign: 'x',
      spend: 50000,
      impressions: null,
      clicks: null,
      mediaCv: null,
      attributedRevenue: null,
    });
    const m = computePeriodMetrics(base);
    expect(m.roas.kind).toBe('na');
    expect(m.attributedRevenue).toBeNull();
  });

  it('セッション未取得ならCVRは理由付きna', () => {
    const m = computePeriodMetrics({ ...fixtureInput(), access: null });
    expect(m.cvr).toEqual({ kind: 'na', reason: 'セッション未取得' });
  });

  it('広告費0のMER/純売上0の率はnaでNaN/Infinityを出さない', () => {
    expect(safeDiv(100, 0, '広告費0')).toEqual({ kind: 'na', reason: '広告費0' });
  });

  it('原価未登録行は暫定件数にカウント', () => {
    const base = fixtureInput();
    base.items[0] = { ...base.items[0], costAtSale: null };
    const m = computePeriodMetrics(base);
    expect(m.cogsMissingLines).toBe(1);
    expect(m.cogs).toBe(495_000);
  });
});

describe('着地予測・比較', () => {
  it('確定3日未満は予測不可', () => {
    const daily = new Map([
      ['2026-09-01', 100],
      ['2026-09-02', 100],
    ]);
    expect(forecastMonthEnd(daily, 30).kind).toBe('na');
  });

  it('未取込日を0にせず確定日平均×日数', () => {
    // 3日確定・平均200 → 30日で6,000（欠測の9/2を0として平均に入れない）
    const daily = new Map([
      ['2026-09-01', 100],
      ['2026-09-03', 200],
      ['2026-09-04', 300],
    ]);
    expect(forecastMonthEnd(daily, 30)).toEqual({ kind: 'value', value: 6000 });
  });

  it('前期間0の増減率は比較不可', () => {
    expect(changeRate(100, 0).kind).toBe('na');
  });
});
