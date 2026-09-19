// 広告分析の検算（docs/metrics.md「広告費」「広告費率」、docs/business.md §6 目標15%/許容20%）。数値は架空の固定データ。
import { describe, expect, it } from 'vitest';
import { adRatioOf, computeAdDay, computeAdMonth, type AdDailyRow } from '../ad-daily';
import { DEFAULT_CPA_THRESHOLDS } from '../cpa';

const T = DEFAULT_CPA_THRESHOLDS; // targetRatio 0.15 / limitRatio 0.20

function row(date: string, sales: number, ad: Partial<AdDailyRow['ad']> = {}): AdDailyRow {
  return { date, salesTotal: sales, ad: { google: 0, rakuten: 0, amazon: 0, meta: 0, ...ad } };
}

describe('広告分析 日次', () => {
  it('docs/metrics.md 検算データ: 広告費100,000 ÷ 売上1,000,000 = 10%（合格）', () => {
    const d = computeAdDay(row('2026-09-01', 1_000_000, { google: 20_000, rakuten: 30_000, amazon: 25_000, meta: 25_000 }), T);
    expect(d.adTotal).toBe(100_000);
    expect(d.ratio).toEqual({ kind: 'value', value: 10 });
    expect(d.judgement).toBe('pass');
  });
  it('判定: 15%以下 合格 / 20%以下 注意 / 超過', () => {
    expect(computeAdDay(row('2026-09-02', 1_000_000, { meta: 150_000 }), T).judgement).toBe('pass'); // 15.0%
    expect(computeAdDay(row('2026-09-03', 1_000_000, { meta: 180_000 }), T).judgement).toBe('warn'); // 18.0%
    expect(computeAdDay(row('2026-09-04', 1_000_000, { meta: 200_001 }), T).judgement).toBe('over'); // 20.0001%
  });
  it('売上0は比率を出さない（NaN/∞を出さない）', () => {
    expect(adRatioOf(1_000, 0)).toEqual({ kind: 'na', reason: '売上0' });
    expect(adRatioOf(0, 0)).toEqual({ kind: 'na', reason: '未取込' });
    expect(computeAdDay(row('2026-09-05', 0, { google: 1_000 }), T).judgement).toBe('na');
  });
});

describe('広告分析 月次', () => {
  const rows = [
    row('2026-09-01', 1_000_000, { google: 20_000, rakuten: 30_000, amazon: 25_000, meta: 25_000 }), // 100,000 / 10%
    row('2026-09-02', 500_000, { meta: 90_000 }), // 18% 注意
    row('2026-09-03', 400_000, { amazon: 100_000 }), // 25% 超過
    row('2026-09-10', 1_000_000, { google: 10_000 }), // 1% 合格（7日移動の窓外を確認する日）
  ];
  const m = computeAdMonth(rows, T);
  it('媒体別合計と構成比（分子分母を再集計・率の単純平均をしない）', () => {
    expect(m.adTotal).toBe(300_000);
    expect(m.salesTotal).toBe(2_900_000);
    expect(m.byMedia.map((b) => [b.key, b.amount])).toEqual([
      ['google', 30_000],
      ['rakuten', 30_000],
      ['amazon', 125_000],
      ['meta', 115_000],
    ]);
    expect(m.byMedia[2].share.kind === 'value' && m.byMedia[2].share.value).toBeCloseTo((125_000 / 300_000) * 100, 6);
    // 月の広告費率 = 300,000 ÷ 2,900,000 = 10.34%（各日の率の平均 13.5% ではない）
    expect(m.ratio.kind === 'value' && m.ratio.value).toBeCloseTo(10.3448, 3);
    expect(m.judgement).toBe('pass');
    expect(m.days).toEqual({ pass: 2, warn: 1, over: 1, na: 0 });
    expect(m.dataDays).toBe(4);
    expect(m.from).toBe('2026-09-01');
    expect(m.to).toBe('2026-09-10');
    expect(m.avgDailyAd).toEqual({ kind: 'value', value: 75_000 });
    expect(m.targetPct).toBe(15);
    expect(m.limitPct).toBe(20);
  });
  it('7日移動広告費は暦日ベース（当日含む7日）で、取込済みの日だけ積む', () => {
    expect(m.rows[0].moving7Ad).toBe(100_000);
    expect(m.rows[1].moving7Ad).toBe(190_000);
    expect(m.rows[2].moving7Ad).toBe(290_000);
    expect(m.rows[2].moving7Days).toBe(3);
    expect(m.rows[2].moving7Ratio.kind === 'value' && m.rows[2].moving7Ratio.value).toBeCloseTo((290_000 / 1_900_000) * 100, 6);
    // 9/10 の窓は 9/4〜9/10。9/1〜9/3 は含まない
    expect(m.rows[3].moving7Ad).toBe(10_000);
    expect(m.rows[3].moving7Days).toBe(1);
  });
  it('データ無し・広告費0 は理由付きの na（数字を作らない）', () => {
    const empty = computeAdMonth([], T);
    expect(empty.dataDays).toBe(0);
    expect(empty.ratio).toEqual({ kind: 'na', reason: '未取込' });
    expect(empty.avgDailyAd.kind).toBe('na');
    expect(empty.judgement).toBe('na');
    const noAd = computeAdMonth([row('2026-09-01', 100_000)], T);
    expect(noAd.byMedia.every((b) => b.share.kind === 'na' && b.share.reason === '広告費0')).toBe(true);
    expect(noAd.ratio).toEqual({ kind: 'value', value: 0 });
  });
  it('同じ日付が重複したら後勝ち・日付順に並べる', () => {
    const r = computeAdMonth([row('2026-09-02', 100, { meta: 1 }), row('2026-09-01', 100, { meta: 2 }), row('2026-09-02', 100, { meta: 3 })], T);
    expect(r.rows.map((d) => [d.date, d.adTotal])).toEqual([
      ['2026-09-01', 2],
      ['2026-09-02', 3],
    ]);
  });
});
