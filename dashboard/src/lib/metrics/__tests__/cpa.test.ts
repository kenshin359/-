// 合算CPA の検算（docs/metrics.md「合算CPA」）。数値は架空の固定データ。
import { describe, expect, it } from 'vitest';
import { computeCpaDay, computeCpaMonth, DEFAULT_CPA_THRESHOLDS, monthDates, shiftDate } from '../cpa';
import type { CpaDailyRow } from '../cpa';
import { parseCpaPaste } from '../../cpa-import';

const T = DEFAULT_CPA_THRESHOLDS; // 客単価30,000 × 15%/20% → 目標4,500 / 許容6,000

function row(date: string, p: Partial<CpaDailyRow>): CpaDailyRow {
  return {
    date,
    suitcaseSales: null,
    meta: 0,
    amazonAds: 0,
    rpp: 0,
    google: 0,
    other: 0,
    unitsAmazon: 0,
    unitsRakuten: 0,
    unitsOwn: 0,
    ...p,
  };
}

describe('合算CPA 日次', () => {
  it('広告費合計÷個数、比率、判定', () => {
    // 広告 100,000+50,000+30,000+20,000=200,000 / 個数 20+20+10=50 → CPA 4,000（合格）
    const d = computeCpaDay(
      row('2026-09-01', { meta: 100000, amazonAds: 50000, rpp: 30000, google: 20000, unitsAmazon: 20, unitsRakuten: 20, unitsOwn: 10, suitcaseSales: 2000000 }),
      T,
    );
    expect(d.adTotal).toBe(200000);
    expect(d.units).toBe(50);
    expect(d.cpa).toEqual({ kind: 'value', value: 4000 });
    expect(d.judgement).toBe('pass');
    expect(d.ratio.kind === 'value' && d.ratio.value).toBeCloseTo(10, 5);
    expect(d.ratioJudgement).toBe('pass');
  });
  it('注意・超過・判定不可', () => {
    expect(computeCpaDay(row('2026-09-02', { meta: 110000, unitsRakuten: 20 }), T).judgement).toBe('warn'); // 5,500
    expect(computeCpaDay(row('2026-09-03', { meta: 130000, unitsRakuten: 20 }), T).judgement).toBe('over'); // 6,500
    const zero = computeCpaDay(row('2026-09-04', { meta: 1000 }), T);
    expect(zero.cpa).toEqual({ kind: 'na', reason: '個数0' });
    expect(zero.judgement).toBe('na');
    const empty = computeCpaDay(row('2026-09-05', {}), T);
    expect(empty.empty).toBe(true);
    expect(empty.cpa.kind).toBe('na');
  });
  it('売上未取得は比率を出さない（代用しない）', () => {
    const d = computeCpaDay(row('2026-09-06', { meta: 1000, unitsOwn: 1 }), T);
    expect(d.ratio).toEqual({ kind: 'na', reason: '売上未取得' });
  });
});

describe('合算CPA 月次', () => {
  const rows = [
    row('2026-09-01', { meta: 200000, unitsRakuten: 50, suitcaseSales: 2000000 }), // 4,000 合格
    row('2026-09-02', { meta: 110000, unitsRakuten: 20, suitcaseSales: 500000 }), // 5,500 注意
    row('2026-09-03', { meta: 130000, unitsRakuten: 20, suitcaseSales: 500000 }), // 6,500 超過
    row('2026-09-04', {}), // 未入力
  ];
  const m = computeCpaMonth(rows, T);
  it('累計と判定日数', () => {
    expect(m.adTotal).toBe(440000);
    expect(m.units).toBe(90);
    expect(m.sales).toBe(3000000);
    expect(m.cpa.kind === 'value' && m.cpa.value).toBeCloseTo(4888.89, 2);
    expect(m.judgement).toBe('warn');
    expect(m.ratio.kind === 'value' && m.ratio.value).toBeCloseTo(14.6667, 3);
    expect(m.ratioJudgement).toBe('pass');
    expect(m.days).toEqual({ pass: 1, warn: 1, over: 1 });
    expect(m.filledDays).toBe(3);
    expect(m.targetCpa).toBe(4500);
    expect(m.limitCpa).toBe(6000);
  });
  it('7日移動CPAは入力済み行だけで積み上げる', () => {
    expect(m.rows[0].moving7).toEqual({ kind: 'value', value: 4000 });
    expect(m.rows[1].moving7.kind === 'value' && m.rows[1].moving7.value).toBeCloseTo(310000 / 70, 6);
    expect(m.rows[2].moving7.kind === 'value' && m.rows[2].moving7.value).toBeCloseTo(440000 / 90, 6);
    expect(m.rows[3].moving7.kind).toBe('na');
  });
  it('日付ユーティリティ', () => {
    expect(shiftDate('2026-09-01', -6)).toBe('2026-08-26');
    expect(monthDates('2026-02').length).toBe(28);
    expect(monthDates('2026-09')[29]).toBe('2026-09-30');
  });
});

describe('貼り付け取込', () => {
  it('Excel「日次」シートのTSV（見出しで対応付け・数式列は無視・合計行は除外）', () => {
    const tsv = [
      '日付\tスーツケース売上\t合算広告費\t広告比率\t合算CPA\t判定\tメタ\tAmazon広告\tRPP\tGoogle\tその他\tAmazon個数\t楽天個数\t自社個数\t7日移動CPA',
      '9/1\t2,000,000\t200000\t10.0%\t4000\t合格\t100,000\t50,000\t30,000\t20,000\t\t20\t20\t10\t4000',
      '9/2\t\t\t\t\t\t\t\t\t\t\t\t\t\t3900',
      '合計\t2000000\t200000\t\t\t\t100000\t50000\t30000\t20000\t0\t20\t20\t10\t',
    ].join('\n');
    const p = parseCpaPaste(tsv, '2026-09');
    expect(p.skipped).toEqual([]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toEqual({
      date: '2026-09-01',
      suitcaseSales: 2000000,
      meta: 100000,
      amazonAds: 50000,
      rpp: 30000,
      google: 20000,
      other: 0,
      unitsAmazon: 20,
      unitsRakuten: 20,
      unitsOwn: 10,
    });
  });
  it('cpa_inputs.json 形式', () => {
    const j = JSON.stringify({ month: '2026-09', units: { '5': { amazon: 1, rakuten: 2, own: 3 } }, ad: { '5': { meta: 10, az: 20, rpp: 30, google: 40 } }, sales: { '5': 90000 } });
    const p = parseCpaPaste(j, '2026-09');
    expect(p.rows).toEqual([
      { date: '2026-09-05', suitcaseSales: 90000, meta: 10, amazonAds: 20, rpp: 30, google: 40, other: 0, unitsAmazon: 1, unitsRakuten: 2, unitsOwn: 3 },
    ]);
  });
  it('見出しが無ければエラーを返す', () => {
    expect(parseCpaPaste('1\t2\t3', '2026-09').skipped[0]).toMatch('日付');
  });
});
