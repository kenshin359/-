// 商品別×チャネル別売上の集計。docs/metrics.md「商品別売上」が正。
// 画面はこのモジュールの結果だけを表示し、独自計算をしない。元データは Kintone 売上明細(29)（ProductSalesDaily）。
import type { MetricValue } from './types';

/** 表示するチャネルの固定順（その他＝上記3つ以外の表記をまとめたもの） */
export const CHANNELS = ['Amazon', '楽天', '自社サイト', 'その他'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Kintone の s_channel 表記を4区分に正規化する。未知の表記は「その他」 */
export function normalizeChannel(raw: string): Channel {
  const s = (raw || '').trim();
  if (s === 'Amazon' || /^amazon$/i.test(s) || s === 'アマゾン') return 'Amazon';
  if (s === '楽天' || /^rakuten$/i.test(s) || s.startsWith('楽天')) return '楽天';
  if (s === '自社サイト' || s === '自社' || /^shopify$/i.test(s) || s === '自社EC') return '自社サイト';
  return 'その他';
}

export interface ProductSalesRow {
  date: string; // YYYY-MM-DD
  channel: string; // 正規化済み（Channel）
  rawChannel?: string;
  product: string;
  units: number;
  amount: number; // 税込
}

export interface ChannelCell {
  amount: number;
  units: number;
}

export interface ProductLine {
  product: string;
  byChannel: Record<Channel, ChannelCell>;
  total: ChannelCell;
  /** 全商品合計に対する売上構成比（%）。合計0なら na */
  share: MetricValue;
  /** 客単価（売上÷個数）。個数0なら na */
  aov: MetricValue;
}

export interface ProductSalesMatrix {
  /** 集計対象の日付範囲（データが存在する日） */
  from: string | null;
  to: string | null;
  days: number;
  lines: ProductLine[]; // 売上合計の多い順
  channelTotals: Record<Channel, ChannelCell>;
  grand: ChannelCell;
  /** 「その他」に含まれた元表記（出典を隠さないため） */
  otherRawChannels: string[];
}

const emptyCell = (): ChannelCell => ({ amount: 0, units: 0 });
const emptyByChannel = (): Record<Channel, ChannelCell> => ({ Amazon: emptyCell(), 楽天: emptyCell(), 自社サイト: emptyCell(), その他: emptyCell() });

function divide(num: number, den: number, reason: string): MetricValue {
  return den ? { kind: 'value', value: num / den } : { kind: 'na', reason };
}

/** 行（同一期間）から 商品×チャネル の行列を作る。チャネルは normalizeChannel で4区分に寄せる */
export function buildProductMatrix(rows: ProductSalesRow[]): ProductSalesMatrix {
  const map = new Map<string, ProductLine>();
  const channelTotals = emptyByChannel();
  const grand = emptyCell();
  const dates = new Set<string>();
  const otherRaw = new Set<string>();
  for (const r of rows) {
    const ch = normalizeChannel(r.channel);
    if (ch === 'その他') otherRaw.add(r.rawChannel || r.channel);
    const line = map.get(r.product) ?? { product: r.product, byChannel: emptyByChannel(), total: emptyCell(), share: { kind: 'na', reason: '合計0' }, aov: { kind: 'na', reason: '個数0' } };
    line.byChannel[ch].amount += r.amount || 0;
    line.byChannel[ch].units += r.units || 0;
    line.total.amount += r.amount || 0;
    line.total.units += r.units || 0;
    channelTotals[ch].amount += r.amount || 0;
    channelTotals[ch].units += r.units || 0;
    grand.amount += r.amount || 0;
    grand.units += r.units || 0;
    dates.add(r.date);
    map.set(r.product, line);
  }
  const lines = [...map.values()]
    .map((l) => ({ ...l, share: divide(l.total.amount * 100, grand.amount, '合計0'), aov: divide(l.total.amount, l.total.units, '個数0') }))
    .sort((a, b) => b.total.amount - a.total.amount || a.product.localeCompare(b.product, 'ja'));
  const sorted = [...dates].sort();
  return {
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    days: sorted.length,
    lines,
    channelTotals,
    grand,
    otherRawChannels: [...otherRaw].sort(),
  };
}

export interface ProductDailyPoint {
  date: string;
  byChannel: Record<Channel, ChannelCell>;
  total: ChannelCell;
}

/** 1商品の日別推移（チャネル別）。日付昇順。データの無い日は含めない（0と未取得を区別するため） */
export function productDailySeries(rows: ProductSalesRow[], product: string): ProductDailyPoint[] {
  const map = new Map<string, ProductDailyPoint>();
  for (const r of rows) {
    if (r.product !== product) continue;
    const ch = normalizeChannel(r.channel);
    const p = map.get(r.date) ?? { date: r.date, byChannel: emptyByChannel(), total: emptyCell() };
    p.byChannel[ch].amount += r.amount || 0;
    p.byChannel[ch].units += r.units || 0;
    p.total.amount += r.amount || 0;
    p.total.units += r.units || 0;
    map.set(r.date, p);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
