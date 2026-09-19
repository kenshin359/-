import { describe, expect, it } from 'vitest';
import type { KpiDailyRow } from '../../pro/kpi-kintone';
import { buildDailyTargets } from '../daily-targets';
import { buildSalesDaily, channelShares, prevDateKey, unitPrice } from '../sales-daily';

function row(date: string, rk: number, az: number, own: number): KpiDailyRow {
  const salesTotal = rk + az + own;
  return {
    date,
    salesRakuten: rk,
    salesAmazon: az,
    salesOwn: own,
    salesTotal,
    target: null,
    adGoogle: 0,
    adRakuten: 0,
    adAmazon: 0,
    adMeta: 0,
    adTotal: 0,
    adRatio: null,
  };
}

describe('売上・利益 日別表（docs/metrics.md 比較・率の規則）', () => {
  // 4月=30日、重み無し、目標 3,000,000 → 日別目標 100,000
  const targets = buildDailyTargets('2026-04', 3_000_000, {});
  const rows = [row('2026-04-03', 60_000, 30_000, 0), row('2026-04-01', 50_000, 30_000, 20_000), row('2026-04-02', 0, 0, 0), row('2026-04-05', 70_000, 30_000, 20_000)];

  it('日付昇順に並べ、前日比は暦日の前日がある日だけ計算する（欠損日をまたがない）', () => {
    const d = buildSalesDaily(rows, targets);
    expect(d.map((r) => r.date)).toEqual(['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-05']);
    expect(d[0].dayOverDay).toEqual({ kind: 'na', reason: '前日なし' });
    expect(d[1].dayOverDay).toEqual({ kind: 'value', value: -100 });
    // 4/3 の前日 4/2 は売上0 → 比較不可
    expect(d[2].dayOverDay).toEqual({ kind: 'na', reason: '比較不可(前日0)' });
    // 4/5 の前日 4/4 は未取込 → 前日なし（4/3 と比較しない）
    expect(d[3].dayOverDay).toEqual({ kind: 'na', reason: '前日なし' });
  });
  it('日別目標・達成率・判定を並べる（≥1.0 好調 / ≥0.7 まずまず / 未満 要改善）', () => {
    const d = buildSalesDaily(rows, targets);
    expect(d[0].target).toBe(100_000);
    expect(d[0].achievement).toEqual({ kind: 'value', value: 100 });
    expect(d[0].judgement).toBe('ok');
    expect(d[2].achievement).toEqual({ kind: 'value', value: 90 });
    expect(d[2].judgement).toBe('warn');
    expect(d[1].judgement).toBe('danger');
    expect(d[3].achievement).toEqual({ kind: 'value', value: 120 });
  });
  it('目標未設定（0）の月は達成率 na・判定 na で、数字を作らない', () => {
    const d = buildSalesDaily(rows, buildDailyTargets('2026-04', 0, {}));
    expect(d[0].target).toBe(0);
    expect(d[0].achievement).toEqual({ kind: 'na', reason: '目標未設定' });
    expect(d[0].judgement).toBe('na');
  });
  it('チャネル別の合計・構成比。行が無ければ空', () => {
    expect(buildSalesDaily([], targets)).toEqual([]);
    const s = channelShares({ rakuten: 500, amazon: 300, own: 200 });
    expect(s.map((c) => c.label)).toEqual(['楽天', 'Amazon', '自社サイト']);
    expect(s[0].share).toEqual({ kind: 'value', value: 50 });
    expect(channelShares({ rakuten: 0, amazon: 0, own: 0 })[0].share).toEqual({ kind: 'na', reason: '合計0' });
  });
  it('客単価（売上明細ベース）= 税込売上 ÷ 個数。個数0は「個数0」', () => {
    expect(unitPrice(300_000, 10)).toEqual({ kind: 'value', value: 30_000 });
    expect(unitPrice(300_000, 0)).toEqual({ kind: 'na', reason: '個数0' });
  });
  it('前日の暦日は月またぎ・年またぎでも正しい', () => {
    expect(prevDateKey('2026-09-01')).toBe('2026-08-31');
    expect(prevDateKey('2026-03-01')).toBe('2026-02-28');
    expect(prevDateKey('2026-01-01')).toBe('2025-12-31');
  });
});
