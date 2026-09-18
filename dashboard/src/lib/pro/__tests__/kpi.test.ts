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
