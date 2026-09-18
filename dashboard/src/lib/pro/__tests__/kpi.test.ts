import { describe, expect, it } from 'vitest';
import { formatKpiValue, judgeKpi, KPI_DEFAULTS, valueAt } from '../kpi';

const def = (code: string) => KPI_DEFAULTS.find((k) => k.code === code)!;

describe('KPI判定（docs/business.md §6 の現場基準）', () => {
  it('合算CPA: ¥4,500以下🟢 / ¥6,000以下🟡 / 超過🔴（buildCpaSheet.py と同じ <= 判定）', () => {
    const cpa = def('suitcase_cpa');
    expect(judgeKpi(cpa, 4500)).toBe('green');
    expect(judgeKpi(cpa, 4501)).toBe('yellow');
    expect(judgeKpi(cpa, 6000)).toBe('yellow');
    expect(judgeKpi(cpa, 6001)).toBe('red');
    expect(judgeKpi(cpa, null)).toBe('na');
  });
  it('広告比率: 15%以下🟢 / 20%以下🟡 / 超過🔴', () => {
    const r = def('ad_ratio');
    expect(judgeKpi(r, 15)).toBe('green');
    expect(judgeKpi(r, 18)).toBe('yellow');
    expect(judgeKpi(r, 20.5)).toBe('red');
  });
  it('ROAS: 2.0未満で危険、閾値以上は正常', () => {
    const r = def('roas');
    expect(judgeKpi(r, 1.9)).toBe('red');
    expect(judgeKpi(r, 2.0)).toBe('green');
    expect(judgeKpi(r, 3.5)).toBe('green');
  });
  it('期限超過タスク: 0件🟢 / 1〜2件🟡 / 3件以上🔴', () => {
    const r = def('overdue_tasks');
    expect(judgeKpi(r, 0)).toBe('green');
    expect(judgeKpi(r, 1)).toBe('yellow');
    expect(judgeKpi(r, 2)).toBe('yellow');
    expect(judgeKpi(r, 3)).toBe('red');
  });
  it('目標だけの up 指標は 達成→正常 / 未達→注意、基準なしは none', () => {
    const s = def('sales_month');
    expect(judgeKpi(s, 110_000_000)).toBe('green');
    expect(judgeKpi(s, 103_400_000)).toBe('yellow');
    expect(judgeKpi(def('cs_low_reviews'), 4)).toBe('none');
    expect(judgeKpi(s, Number.NaN)).toBe('na');
  });
  it('初期KPIはすべて手入力（source=manual）で、出典を補足に持つ', () => {
    expect(KPI_DEFAULTS.map((k) => k.code)).toEqual(['sales_month', 'ad_ratio', 'suitcase_cpa', 'roas', 'cs_low_reviews', 'overdue_tasks']);
    for (const k of KPI_DEFAULTS) {
      expect(k.source).toBe('manual');
      expect(k.note).toContain('docs/business.md');
    }
  });
});

describe('表示と前後比較の補助', () => {
  it('値が無ければ「未取得」、単位ごとの書式', () => {
    expect(formatKpiValue(null, '円')).toBe('未取得');
    expect(formatKpiValue(4500, '円')).toBe('¥4,500');
    expect(formatKpiValue(15.04, '%')).toBe('15.0%');
    expect(formatKpiValue(2, '倍')).toBe('2.00倍');
    expect(formatKpiValue(3, '件')).toBe('3件');
  });
  it('valueAt は指定日以前の最新値（無ければ null）', () => {
    const s = [
      { date: '2026-09-01', value: 5000 },
      { date: '2026-09-10', value: 4800 },
      { date: '2026-09-15', value: 4400 },
    ];
    expect(valueAt(s, '2026-08-31')).toBeNull();
    expect(valueAt(s, '2026-09-10')).toBe(4800);
    expect(valueAt(s, '2026-09-12')).toBe(4800);
    expect(valueAt(s, '2026-12-01')).toBe(4400);
  });
});

describe('取込データからのKPI自動算出（当月累計）', () => {
  it('月間売上は日別売上の累計、合算CPA/広告比率は累計広告費÷累計個数/累計スーツケース売上', async () => {
    const { deriveKpiSeries, DERIVED_NOTE } = await import('../kpi');
    const sales = [
      { date: '2026-09-02', salesRakuten: 200, salesAmazon: 100, salesOwn: 50 },
      { date: '2026-09-01', salesRakuten: 1000, salesAmazon: 500, salesOwn: 100 },
    ];
    const cpa = [
      { date: '2026-09-01', suitcaseSales: 100000, meta: 3000, amazonAds: 1000, rpp: 500, google: 500, other: 0, unitsAmazon: 1, unitsRakuten: 1, unitsOwn: 0 },
      { date: '2026-09-02', suitcaseSales: null, meta: 4000, amazonAds: 0, rpp: 0, google: 1000, other: 0, unitsAmazon: 0, unitsRakuten: 2, unitsOwn: 1 },
    ];
    const s = deriveKpiSeries(sales, cpa);
    expect(s.get('sales_month')?.map((p) => [p.date, p.value])).toEqual([
      ['2026-09-01', 1600],
      ['2026-09-02', 1950],
    ]);
    // 9/1: 5000÷2=2500、9/2: (5000+5000)÷(2+3)=2000
    expect(s.get('suitcase_cpa')?.map((p) => p.value)).toEqual([2500, 2000]);
    // 広告比率: 9/1 5000÷100000=5%、9/2 は売上未取得のため累計売上据え置きで 10000÷100000=10%
    expect(s.get('ad_ratio')?.map((p) => p.value)).toEqual([5, 10]);
    expect(s.get('sales_month')?.[0].note).toBe(DERIVED_NOTE);
    expect(s.has('roas')).toBe(false); // 帰属売上が無いので算出しない
  });
  it('行が無ければ何も算出しない（未取得のまま）', async () => {
    const { deriveKpiSeries } = await import('../kpi');
    expect(deriveKpiSeries([], []).size).toBe(0);
  });
});
