// 日別売上CSVの検算。数値は架空の固定データ。
import { describe, expect, it } from 'vitest';
import { buildDailySalesCsv, CSV_BOM, csvEscape, csvFileName, DAILY_SALES_CSV_HEADER, type DailySalesCsvRow } from '../daily-sales-csv';

function row(date: string, o: Partial<DailySalesCsvRow> = {}): DailySalesCsvRow {
  return { date, salesRakuten: 0, salesAmazon: 0, salesOwn: 0, target: null, adGoogle: 0, adRakuten: 0, adAmazon: 0, adMeta: 0, ...o };
}

describe('日別売上CSV', () => {
  it('UTF-8 BOM で始まり、見出し行＋CRLF、ファイル名は月付き', () => {
    const csv = buildDailySalesCsv([]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe(DAILY_SALES_CSV_HEADER.join(',') + '\r\n');
    expect(csvFileName('2026-09')).toBe('daily-sales-2026-09.csv');
  });
  it('行の値: 合計・広告費合計・広告費率(1桁)。目標未入力は空欄（0で埋めない）', () => {
    const csv = buildDailySalesCsv([
      row('2026-09-01', { salesRakuten: 300_000, salesAmazon: 500_000, salesOwn: 200_000, adGoogle: 20_000, adRakuten: 30_000, adAmazon: 25_000, adMeta: 25_000 }),
    ]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toBe('2026-09-01,300000,500000,200000,1000000,,20000,30000,25000,25000,100000,10.0');
    expect(lines[2]).toBe('');
  });
  it('売上0の日は広告費率を空欄にする。日付順に並べる', () => {
    const csv = buildDailySalesCsv([row('2026-09-02', { adMeta: 100, target: 3_500_000 }), row('2026-09-01', { salesOwn: 100 })]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1].startsWith('2026-09-01,')).toBe(true);
    expect(lines[2]).toBe('2026-09-02,0,0,0,0,3500000,0,0,0,100,100,');
  });
  it('カンマ・引用符・改行を含む値だけ引用する', () => {
    expect(csvEscape('abc')).toBe('abc');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('x\ny')).toBe('"x\ny"');
  });
});
