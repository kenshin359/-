// 日別売上CSV（/api/reports/daily-sales.csv）の生成。元データは KpiDaily（Kintone 毎朝KPI報告(30) の日次取込）。
// Excel で開けるように UTF-8 BOM ＋ CRLF。数字は取込値のみ（率は分子÷分母をここで計算。売上0は空欄）。
import { adRatioOf } from './ad-daily';

export const DAILY_SALES_CSV_HEADER = [
  '日付',
  '楽天',
  'Amazon',
  '自社サイト',
  '売上合計',
  '日別目標',
  'Google広告費',
  '楽天RPP',
  'Amazon広告',
  'Meta',
  '広告費合計',
  '広告費率(%)',
] as const;

export interface DailySalesCsvRow {
  date: string;
  salesRakuten: number;
  salesAmazon: number;
  salesOwn: number;
  /** 日別目標。未入力は null（空欄で出す。0で埋めない） */
  target: number | null;
  adGoogle: number;
  adRakuten: number;
  adAmazon: number;
  adMeta: number;
}

export const CSV_BOM = '﻿';

/** カンマ・改行・引用符を含む値だけ引用する */
export function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvFileName(month: string): string {
  return `daily-sales-${month}.csv`;
}

export function buildDailySalesCsv(rows: DailySalesCsvRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lines: string[] = [DAILY_SALES_CSV_HEADER.join(',')];
  for (const r of sorted) {
    const sales = r.salesRakuten + r.salesAmazon + r.salesOwn;
    const ad = r.adGoogle + r.adRakuten + r.adAmazon + r.adMeta;
    const ratio = adRatioOf(ad, sales);
    lines.push(
      [
        r.date,
        String(r.salesRakuten),
        String(r.salesAmazon),
        String(r.salesOwn),
        String(sales),
        r.target == null ? '' : String(r.target),
        String(r.adGoogle),
        String(r.adRakuten),
        String(r.adAmazon),
        String(r.adMeta),
        String(ad),
        ratio.kind === 'value' ? ratio.value.toFixed(1) : '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
