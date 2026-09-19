// 日別目標（イベント加重）の検算。朝礼スクリプト（newsDaily.py / buildChoreiSheet.py）と同じ式・同じ判定になることを確認する。
import { describe, expect, it } from 'vitest';
import {
  computeDailyTargets,
  dailyTargetMap,
  daysInMonthOf,
  judgeAgainstTarget,
  parseEventCalendar,
  targetRate,
  totalWeight,
  weightOf,
  type EventCalendar,
} from '../daily-target';
import calendar2609 from '@/data/events/events-2026-09.json';

// 固定データ: 30日の月・目標3,000万。1日だけ重み2.0、他は1.0 → 重み合計 31
const FIXTURE: EventCalendar = {
  month: '2026-09',
  targets: { main: 30_000_000, stretch: 31_000_000 },
  events: { '1': { label: 'セール', weight: 2.0 } },
};

describe('重みと日数', () => {
  it('月の日数', () => {
    expect(daysInMonthOf('2026-09')).toBe(30);
    expect(daysInMonthOf('2026-02')).toBe(28);
    expect(daysInMonthOf('2026-08')).toBe(31);
  });
  it('未記載の日は重み1.0・合計は日数＋加算分', () => {
    expect(weightOf(FIXTURE, 1)).toBe(2);
    expect(weightOf(FIXTURE, 2)).toBe(1);
    expect(totalWeight(FIXTURE)).toBe(31); // 29日×1.0 + 1日×2.0
  });
});

describe('日別目標の配分（朝礼と同じ式）', () => {
  const days = computeDailyTargets(FIXTURE);
  it('日次目標 = 月間目標 × 重み ÷ 重み合計', () => {
    expect(days).toHaveLength(30);
    expect(days[0].main).toBe(Math.round((30_000_000 * 2) / 31)); // 1,935,484
    expect(days[1].main).toBe(Math.round(30_000_000 / 31)); // 967,742
    expect(days[0].stretch).toBe(Math.round((31_000_000 * 2) / 31)); // 2,000,000
  });
  it('累計は積み上がり、月末は月間目標にほぼ一致（四捨五入の差のみ）', () => {
    const last = days[days.length - 1];
    expect(last.cumulativeMain).toBeGreaterThan(29_999_000);
    expect(last.cumulativeMain).toBeLessThan(30_001_000);
    expect(days[1].cumulativeMain).toBe(days[0].main + days[1].main);
  });
  it('日付キーの早見表', () => {
    const m = dailyTargetMap(FIXTURE);
    expect(m.get('2026-09-01')).toBe(days[0].main);
    expect(m.get('2026-09-30')).toBe(days[29].main);
    expect(m.get('2026-10-01')).toBeUndefined();
  });
});

describe('判定（朝礼と一致）', () => {
  it('1.0以上=好調 / 0.7以上=まずまず / 未満=要改善', () => {
    expect(judgeAgainstTarget(1_000_000, 1_000_000)).toBe('good');
    expect(judgeAgainstTarget(1_200_000, 1_000_000)).toBe('good');
    expect(judgeAgainstTarget(700_000, 1_000_000)).toBe('fair');
    expect(judgeAgainstTarget(999_999, 1_000_000)).toBe('fair');
    expect(judgeAgainstTarget(699_999, 1_000_000)).toBe('poor');
  });
  it('目標が無い日は判定しない（0で埋めない）', () => {
    expect(judgeAgainstTarget(500_000, null)).toBe('na');
    expect(judgeAgainstTarget(500_000, 0)).toBe('na');
    expect(targetRate(500_000, null)).toEqual({ kind: 'na', reason: '目標未設定' });
    expect(targetRate(500_000, 1_000_000)).toEqual({ kind: 'value', value: 50 });
  });
});

describe('カレンダーの読み込み', () => {
  it('壊れた内容は null を返す（推測で補わない）', () => {
    expect(parseEventCalendar(null)).toBeNull();
    expect(parseEventCalendar({ month: '2026-9', targets: { main: 1 } })).toBeNull();
    expect(parseEventCalendar({ month: '2026-09' })).toBeNull();
    expect(parseEventCalendar({ month: '2026-09', targets: { main: 0 } })).toBeNull();
  });
  it('範囲外の日・不正な重みは落とす／既定1.0', () => {
    const c = parseEventCalendar({
      month: '2026-09',
      targets: { main: 100 },
      events: { '31': { label: 'ありえない日', weight: 3 }, '5': { weight: -1 }, '6': { label: 'X', weight: 1.7 } },
    });
    expect(c).not.toBeNull();
    expect(c!.events['31']).toBeUndefined(); // 9月は30日まで
    expect(c!.events['5'].weight).toBe(1); // 負の重みは1.0に落とす
    expect(c!.events['6']).toEqual({ label: 'X', weight: 1.7 });
    expect(c!.targets.stretch).toBe(100); // stretch 未指定は main と同じ
  });
  it('同梱の 2026-09 カレンダーが読め、配分の合計が月間目標に一致する', () => {
    const cal = parseEventCalendar(calendar2609);
    expect(cal).not.toBeNull();
    expect(cal!.targets.main).toBe(110_000_000);
    const days = computeDailyTargets(cal!);
    expect(days).toHaveLength(30);
    const sum = days.reduce((s, d) => s + d.main, 0);
    expect(Math.abs(sum - 110_000_000)).toBeLessThan(30); // 1日あたり最大0.5円の丸め差
    // スーパーSALE（9/5）は通常日より目標が厚い
    const sale = days.find((d) => d.day === 5)!;
    const normal = days.find((d) => d.day === 25)!;
    expect(sale.weight).toBe(2);
    expect(sale.main).toBeGreaterThan(normal.main * 1.9);
  });
});
