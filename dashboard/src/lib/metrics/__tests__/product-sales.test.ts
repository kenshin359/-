import { describe, expect, it } from 'vitest';
import { buildProductMatrix, normalizeChannel, productDailySeries } from '../product-sales';

const rows = [
  { date: '2026-09-01', channel: '楽天', product: 'スーツケースM', units: 2, amount: 60000 },
  { date: '2026-09-01', channel: 'Amazon', product: 'スーツケースM', units: 1, amount: 28000 },
  { date: '2026-09-02', channel: '自社サイト', product: 'スーツケースM', units: 1, amount: 32000 },
  { date: '2026-09-02', channel: 'Yahoo', rawChannel: 'Yahoo', product: 'クリップファン', units: 3, amount: 9000 },
  { date: '2026-09-02', channel: '楽天', product: 'クリップファン', units: 1, amount: 3000 },
];

describe('商品別×チャネル別売上（docs/metrics.md 商品別売上）', () => {
  it('チャネル表記は Amazon／楽天／自社サイト／その他 の4区分に寄せる', () => {
    expect(normalizeChannel('楽天')).toBe('楽天');
    expect(normalizeChannel('楽天市場')).toBe('楽天');
    expect(normalizeChannel('amazon')).toBe('Amazon');
    expect(normalizeChannel('自社')).toBe('自社サイト');
    expect(normalizeChannel('Yahoo')).toBe('その他');
    expect(normalizeChannel('')).toBe('その他');
  });
  it('商品ごとにチャネル別の売上・個数と合計・構成比・客単価を出し、売上の多い順に並べる', () => {
    const m = buildProductMatrix(rows);
    expect(m.lines.map((l) => l.product)).toEqual(['スーツケースM', 'クリップファン']);
    const sc = m.lines[0];
    expect(sc.byChannel.楽天).toEqual({ amount: 60000, units: 2 });
    expect(sc.byChannel.Amazon).toEqual({ amount: 28000, units: 1 });
    expect(sc.byChannel.自社サイト).toEqual({ amount: 32000, units: 1 });
    expect(sc.byChannel.その他).toEqual({ amount: 0, units: 0 });
    expect(sc.total).toEqual({ amount: 120000, units: 4 });
    expect(sc.aov).toEqual({ kind: 'value', value: 30000 });
    // 構成比 = 120000 / 132000
    expect(sc.share.kind).toBe('value');
    if (sc.share.kind === 'value') expect(sc.share.value).toBeCloseTo(90.909, 2);
    expect(m.channelTotals.その他).toEqual({ amount: 9000, units: 3 });
    expect(m.grand).toEqual({ amount: 132000, units: 8 });
    expect(m.otherRawChannels).toEqual(['Yahoo']);
    expect(m.from).toBe('2026-09-01');
    expect(m.to).toBe('2026-09-02');
    expect(m.days).toBe(2);
  });
  it('行が無ければ合計0・構成比/客単価は na（推測で埋めない）', () => {
    const m = buildProductMatrix([]);
    expect(m.lines).toEqual([]);
    expect(m.grand).toEqual({ amount: 0, units: 0 });
    expect(m.from).toBeNull();
  });
  it('1商品の日別推移はチャネル別に日付昇順で、データの無い日は含めない', () => {
    const s = productDailySeries(rows, 'スーツケースM');
    expect(s.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(s[0].total).toEqual({ amount: 88000, units: 3 });
    expect(s[1].byChannel.自社サイト.amount).toBe(32000);
  });
});
