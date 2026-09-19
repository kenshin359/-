import { describe, expect, it } from 'vitest';
import { normalizePostStatus, parseSnsPosts, summarizeSns } from '../sns-schedule';
import { parseTimeCell } from '../sheet-cells';

const TODAY = '2026-09-19';
const header = ['投稿予定日', '時刻', '媒体', 'アカウント', '担当', '内容（キャプション）', '素材リンク', '状態', '投稿URL', '結果（いいね）', '結果（再生）', 'メモ'];

describe('SNS投稿スケジュール（docs/metrics.md SNS投稿）', () => {
  it('状態: 案／承認待ち／予約済／投稿済', () => {
    expect(normalizePostStatus('投稿済')).toBe('posted');
    expect(normalizePostStatus('予約済')).toBe('scheduled');
    expect(normalizePostStatus('承認待ち')).toBe('pending');
    expect(normalizePostStatus('案')).toBe('draft');
    expect(normalizePostStatus('')).toBe('draft');
  });
  it('時刻: Date／"12:30"／"9時"／シリアル値', () => {
    expect(parseTimeCell('12:30')).toBe('12:30');
    expect(parseTimeCell('9時')).toBe('09:00');
    expect(parseTimeCell(0.5)).toBe('12:00');
    expect(parseTimeCell('')).toBe('');
  });
  it('使い方の行は無視し、予定日の無い行は除外。今日・未投稿・7日先・承認待ち・3日先の空きを集計', () => {
    const rows = [
      ['使い方: 1行＝1投稿'],
      header,
      ['2026/09/17', '12:00', 'Instagram', 'libetee.inc_japan', '倉内', 'スーパーセール告知', '', '予約済', '', '', '', ''],
      ['2026/09/18', '', 'TikTok', 'libetee.inc', '倉内', '動画A', '', '投稿済', 'https://t/1', '120', '3000', ''],
      [new Date(2026, 8, 19), '19:00', 'Instagram', 'libetee.inc_japan', '', '本日の投稿', '', '承認待ち', '', '', '', ''],
      ['2026/09/25', '', 'Instagram', 'libetee.inc_japan', '倉内', '来週', '', '案', '', '', '', ''],
      ['', '', 'Instagram', '', '', '日付なし', '', '案', '', '', '', ''],
    ];
    const posts = parseSnsPosts(rows, TODAY);
    expect(posts.map((p) => p.date)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-25']);
    expect(posts[1]).toMatchObject({ status: 'posted', likes: 120, views: 3000, postUrl: 'https://t/1' });
    const s = summarizeSns(posts, TODAY);
    expect(s.total).toBe(4);
    expect(s.today.map((p) => p.content)).toEqual(['本日の投稿']);
    expect(s.unposted.map((p) => p.content)).toEqual(['スーパーセール告知']); // 9/17 予約済のまま
    expect(s.upcoming7.map((p) => p.date)).toEqual(['2026-09-19', '2026-09-25']);
    expect(s.pending.length).toBe(1);
    expect(s.gap3).toBe(true); // 9/20〜9/22 に予定なし
    expect(s.monthPlanned).toBe(4);
    expect(s.monthPosted).toBe(1);
    expect(s.monthByMedia).toEqual([
      { media: 'Instagram', planned: 3, posted: 0 },
      { media: 'TikTok', planned: 1, posted: 1 },
    ]);
  });
  it('見出しが無ければ空', () => {
    expect(parseSnsPosts([['a'], ['b']], TODAY)).toEqual([]);
  });
});
