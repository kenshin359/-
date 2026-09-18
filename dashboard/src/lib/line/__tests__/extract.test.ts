import { describe, expect, it } from 'vitest';
import { extract, isCompletion, parseDue, similarity } from '../extract';

// JST 2026-09-18(金) 12:00
const NOW = new Date('2026-09-18T03:00:00Z');

describe('extract: 依頼・約束の抽出（LINE監査役）', () => {
  it('「@名前 〜お願いします」→ high・担当・タイトル', () => {
    const r = extract('@角南 広告CSVを9/20までに添付お願いします', NOW);
    expect(r).not.toBeNull();
    expect(r!.confidence).toBe('high');
    expect(r!.kind).toBe('request');
    expect(r!.assigneeName).toBe('角南');
    expect(r!.due).toBe('2026-09-20');
    expect(r!.title).toBe('広告CSVを9/20までに添付お願いします');
  });

  it('文頭の「名前さん」を担当にし、「9月20日」を期限にする', () => {
    const r = extract('黒葛原さん、LPの修正を9月20日までに完了してください', NOW);
    expect(r!.assigneeName).toBe('黒葛原');
    expect(r!.due).toBe('2026-09-20');
    expect(r!.confidence).toBe('high');
  });

  it('「明日」「今日中」「明後日」は JST の now 基準', () => {
    expect(parseDue('明日までに送ってください', NOW)).toBe('2026-09-19');
    expect(parseDue('今日中にお願いします', NOW)).toBe('2026-09-18');
    expect(parseDue('明後日までにやります', NOW)).toBe('2026-09-20');
  });

  it('「今週中」は金曜、「来週」は来週の金曜、「月末」は月の末日', () => {
    const wed = new Date('2026-09-16T03:00:00Z'); // 水
    expect(parseDue('今週中にお願いします', wed)).toBe('2026-09-18');
    expect(parseDue('来週までにお願いします', wed)).toBe('2026-09-25');
    expect(parseDue('月末までに提出してください', NOW)).toBe('2026-09-30');
  });

  it('「20日まで」は今月、過ぎていれば来月。過去の M/D は来年扱いにならない（半年以内）', () => {
    expect(parseDue('20日までに確認お願いします', NOW)).toBe('2026-09-20');
    expect(parseDue('5日までに確認お願いします', NOW)).toBe('2026-10-05');
    expect(parseDue('9/10の件、確認お願いします', NOW)).toBe('2026-09-10');
    expect(parseDue('1/15までに', NOW)).toBe('2027-01-15');
  });

  it('約束句（やります）は期限か担当がなければ low、あれば high', () => {
    const low = extract('了解です、対応します', NOW);
    expect(low).not.toBeNull();
    expect(low!.confidence).toBe('low');
    expect(low!.kind).toBe('promise');
    const high = extract('レビュー返信は明日やります', NOW);
    expect(high!.confidence).toBe('high');
    expect(high!.due).toBe('2026-09-19');
  });

  it('依頼句のない雑談は null', () => {
    expect(extract('おはようございます！今日も頑張りましょう', NOW)).toBeNull();
    expect(extract('了解です', NOW)).toBeNull();
    expect(extract('', NOW)).toBeNull();
  });

  it('タイトルは80文字以内に切り、@メンションとURLを除く', () => {
    const long = `@笹本 ${'あ'.repeat(120)}お願いします https://example.com/x`;
    const r = extract(long, NOW);
    expect(r!.title.length).toBeLessThanOrEqual(80);
    expect(r!.title).not.toContain('@');
    expect(r!.title).not.toContain('http');
  });

  it('「皆さん」「@監査役」は担当にしない', () => {
    expect(extract('皆さん、明日までに日報をお願いします', NOW)!.assigneeName).toBeUndefined();
    expect(extract('@監査役 明日までに日報をお願いします', NOW)!.assigneeName).toBeUndefined();
  });

  it('金曜まで → 次の金曜（当日なら今日）', () => {
    expect(parseDue('金曜までにお願いします', NOW)).toBe('2026-09-18');
    expect(parseDue('月曜までにお願いします', NOW)).toBe('2026-09-21');
  });
});

describe('isCompletion / similarity', () => {
  it('完了報告の言い回しを検知する', () => {
    expect(isCompletion('広告CSV添付、完了しました')).toBe(true);
    expect(isCompletion('終わりました！')).toBe(true);
    expect(isCompletion('done')).toBe(true);
    expect(isCompletion('対応済みです')).toBe(true);
    expect(isCompletion('明日までにお願いします')).toBe(false);
  });
  it('完了報告は約束として抽出しない', () => {
    expect(extract('対応します、完了しました', NOW)).toBeNull();
  });
  it('本文の近さで追いかけを照合できる', () => {
    expect(similarity('広告CSVを添付お願いします', '広告CSV 添付しました 完了')).toBeGreaterThan(0.3);
    expect(similarity('広告CSVを添付お願いします', '在庫の発注終わりました')).toBeLessThan(0.3);
  });
});
