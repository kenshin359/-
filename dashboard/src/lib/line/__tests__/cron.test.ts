import { describe, expect, it } from 'vitest';
import { cronMatches, isValidCron, lastMatchWithin, nextMatch, parseCron, shouldFire } from '../cron';

// JST 2026-09-18(金) 08:00 = UTC 23:00 (9/17)
const FRI_0800 = new Date('2026-09-17T23:00:00Z');

describe('cron（JST・5フィールド）', () => {
  it('パースと妥当性', () => {
    expect(isValidCron('0 8 * * 1-5')).toBe(true);
    expect(isValidCron('*/10 * * * *')).toBe(true);
    expect(isValidCron('0 8,18 * * *')).toBe(true);
    expect(isValidCron('0 8 * *')).toBe(false);
    expect(isValidCron('60 8 * * *')).toBe(false);
    expect(isValidCron('a b c d e')).toBe(false);
    expect(parseCron('0 8 * * 7')!.dow.has(0)).toBe(true);
  });

  it('JST で一致判定する（UTC の値ではない）', () => {
    expect(cronMatches('0 8 * * *', FRI_0800)).toBe(true);
    expect(cronMatches('0 23 * * *', FRI_0800)).toBe(false);
    expect(cronMatches('0 8 * * 5', FRI_0800)).toBe(true);
    expect(cronMatches('0 8 * * 1-4', FRI_0800)).toBe(false);
    expect(cronMatches('0 8 18 9 *', FRI_0800)).toBe(true);
    expect(cronMatches('*/10 * * * *', new Date('2026-09-17T23:30:00Z'))).toBe(true);
    expect(cronMatches('*/10 * * * *', new Date('2026-09-17T23:31:00Z'))).toBe(false);
  });

  it('直近 window 分以内の一致を返す（Vercel Cron の遅れを吸収）', () => {
    const late = new Date('2026-09-17T23:04:00Z'); // JST 08:04
    expect(lastMatchWithin('0 8 * * *', late, 15)!.toISOString()).toBe('2026-09-17T23:00:00.000Z');
    expect(lastMatchWithin('0 8 * * *', new Date('2026-09-17T23:30:00Z'), 15)).toBeNull();
  });

  it('shouldFire は lastRunAt がその枠以降なら二重実行しない', () => {
    const late = new Date('2026-09-17T23:04:00Z');
    expect(shouldFire('0 8 * * *', late, null).fire).toBe(true);
    expect(shouldFire('0 8 * * *', late, new Date('2026-09-17T23:01:00Z')).fire).toBe(false);
    expect(shouldFire('0 8 * * *', late, new Date('2026-09-16T23:01:00Z')).fire).toBe(true);
  });

  it('nextMatch は次の一致時刻（JST）を返す', () => {
    expect(nextMatch('0 18 * * *', FRI_0800)!.toISOString()).toBe('2026-09-18T09:00:00.000Z');
    // 金曜 08:00 の次の平日 08:00 は月曜
    expect(nextMatch('0 8 * * 1-5', FRI_0800)!.toISOString()).toBe('2026-09-20T23:00:00.000Z');
    expect(nextMatch('0 8 31 2 *', FRI_0800)).toBeNull();
  });
});
