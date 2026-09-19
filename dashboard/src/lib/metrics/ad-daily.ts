// 広告分析（/ads）の集計。docs/metrics.md「広告費」「広告費率」が正。
// 元データは KpiDaily（Kintone 毎朝KPI報告(30) の日次取込: 媒体別広告費 ad* 列＋媒体別売上）。
// 判定は合算CPA（src/lib/metrics/cpa.ts）と同じ閾値（targetRatio 15% / limitRatio 20%、docs/business.md §6）を judgeRatio で共用し、独自計算をしない。
// ROAS・ACOS・CPC・CPM・CTR は帰属売上・クリック・表示回数の取込が無いため「未取得」（総売上÷広告費で代用しない）。
import { judgeRatio, shiftDate, type CpaJudgement, type CpaThresholds } from './cpa';
import type { MetricValue } from './types';

/** 表示する媒体の固定順（KpiDaily の ad* 列に対応） */
export const AD_MEDIA = [
  { key: 'google', label: 'Google', column: 'adGoogle' },
  { key: 'rakuten', label: '楽天RPP', column: 'adRakuten' },
  { key: 'amazon', label: 'Amazon広告', column: 'adAmazon' },
  { key: 'meta', label: 'Meta', column: 'adMeta' },
] as const;
export type AdMediaKey = (typeof AD_MEDIA)[number]['key'];
export type AdByMedia = Record<AdMediaKey, number>;

/** 取込が無く出せない指標と、その理由（画面はこの文言をそのまま出す） */
export const AD_UNAVAILABLE_METRICS: { label: string; formula: string; reason: string }[] = [
  { label: 'ROAS', formula: '広告帰属売上 ÷ 広告費', reason: '未取得（媒体報告の帰属売上の取込なし。総売上÷広告費で代用しない）' },
  { label: 'ACOS', formula: '広告費 ÷ 広告帰属売上', reason: '未取得（帰属売上の取込なし）' },
  { label: 'CPC', formula: '広告費 ÷ クリック数', reason: '未取得（クリック数の取込なし）' },
  { label: 'CPM', formula: '広告費 ÷ 表示回数 × 1000', reason: '未取得（表示回数の取込なし）' },
  { label: 'CTR', formula: 'クリック ÷ 表示 × 100', reason: '未取得（クリック・表示回数の取込なし）' },
  { label: 'CPA（媒体報告CV）', formula: '広告費 ÷ 媒体報告CV', reason: '未取得（媒体CVの取込なし。スーツケース合算CPAは /ads/cpa）' },
];

export interface AdDailyRow {
  /** JST暦日 YYYY-MM-DD */
  date: string;
  /** 楽天＋Amazon＋自社 の売上合計 */
  salesTotal: number;
  ad: AdByMedia;
}

export interface AdDayResult {
  date: string;
  salesTotal: number;
  ad: AdByMedia;
  adTotal: number;
  /** 広告費率 = 広告費 ÷ 売上 × 100（%）。売上0は na */
  ratio: MetricValue;
  judgement: CpaJudgement;
  /** 直近7暦日（当日含む・取込済みの日のみ）の広告費合計 */
  moving7Ad: number;
  /** 上記に含めた日数 */
  moving7Days: number;
  /** 直近7暦日の Σ広告費 ÷ Σ売上 × 100 */
  moving7Ratio: MetricValue;
}

export interface AdMediaTotal {
  key: AdMediaKey;
  label: string;
  amount: number;
  /** 月合計に対する構成比（%）。広告費合計0なら na */
  share: MetricValue;
}

export interface AdMonthResult {
  /** 取込済みの日数 */
  dataDays: number;
  from: string | null;
  to: string | null;
  adTotal: number;
  salesTotal: number;
  byMedia: AdMediaTotal[];
  ratio: MetricValue;
  judgement: CpaJudgement;
  /** 1日あたり広告費（合計 ÷ 取込日数）。日数0は na */
  avgDailyAd: MetricValue;
  days: { pass: number; warn: number; over: number; na: number };
  /** 判定閾値（%）。表示用 */
  targetPct: number;
  limitPct: number;
  rows: AdDayResult[];
}

export function adTotalOf(ad: AdByMedia): number {
  return (ad.google || 0) + (ad.rakuten || 0) + (ad.amazon || 0) + (ad.meta || 0);
}

/** 広告費率（%）。売上0は「売上0」、広告費も売上も0は「未取込」 */
export function adRatioOf(adTotal: number, sales: number): MetricValue {
  if (sales <= 0) return { kind: 'na', reason: adTotal === 0 ? '未取込' : '売上0' };
  return { kind: 'value', value: (adTotal / sales) * 100 };
}

export function computeAdDay(r: AdDailyRow, t: CpaThresholds): Omit<AdDayResult, 'moving7Ad' | 'moving7Days' | 'moving7Ratio'> {
  const adTotal = adTotalOf(r.ad);
  const ratio = adRatioOf(adTotal, r.salesTotal);
  return { date: r.date, salesTotal: r.salesTotal, ad: r.ad, adTotal, ratio, judgement: judgeRatio(ratio, t) };
}

/** 月内の行（日付順でなくてもよい・同じ日付は後勝ち）から月次結果を作る */
export function computeAdMonth(rows: AdDailyRow[], t: CpaThresholds): AdMonthResult {
  const byDate = new Map<string, AdDailyRow>();
  for (const r of rows) byDate.set(r.date, r);
  const sorted = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const days = sorted.map((r) => computeAdDay(r, t));

  const out: AdDayResult[] = days.map((d, i) => {
    const from = shiftDate(d.date, -6);
    let ad = 0;
    let sales = 0;
    let n = 0;
    for (let j = 0; j <= i; j++) {
      const x = days[j];
      if (x.date < from) continue;
      ad += x.adTotal;
      sales += x.salesTotal;
      n++;
    }
    return { ...d, moving7Ad: ad, moving7Days: n, moving7Ratio: adRatioOf(ad, sales) };
  });

  const adTotal = out.reduce((a, d) => a + d.adTotal, 0);
  const salesTotal = out.reduce((a, d) => a + d.salesTotal, 0);
  const byMedia: AdMediaTotal[] = AD_MEDIA.map((m) => {
    const amount = out.reduce((a, d) => a + (d.ad[m.key] || 0), 0);
    return {
      key: m.key,
      label: m.label,
      amount,
      share: adTotal > 0 ? { kind: 'value', value: (amount / adTotal) * 100 } : { kind: 'na', reason: '広告費0' },
    };
  });
  const ratio = out.length ? adRatioOf(adTotal, salesTotal) : { kind: 'na' as const, reason: '未取込' };
  return {
    dataDays: out.length,
    from: out.length ? out[0].date : null,
    to: out.length ? out[out.length - 1].date : null,
    adTotal,
    salesTotal,
    byMedia,
    ratio,
    judgement: judgeRatio(ratio, t),
    avgDailyAd: out.length ? { kind: 'value', value: adTotal / out.length } : { kind: 'na', reason: '未取込' },
    days: {
      pass: out.filter((d) => d.judgement === 'pass').length,
      warn: out.filter((d) => d.judgement === 'warn').length,
      over: out.filter((d) => d.judgement === 'over').length,
      na: out.filter((d) => d.judgement === 'na').length,
    },
    targetPct: t.targetRatio * 100,
    limitPct: t.limitRatio * 100,
    rows: out,
  };
}
