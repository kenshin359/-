import { describe, expect, it } from 'vitest';
import { normalizeStatus, parseCreativeRequests, parseDateCell, parseDue, sortOpen, summarizeCreativeRequests } from '../creative-requests';

const header = ['NO.', '作成者', '保存先', '', '依頼日', '依頼者', '画像納期', '媒体', '用途(掲載場所）', 'サイズ', 'イベント名', '期間', '対象商品', 'メイン商品', '内容', '', '強調したい内容', '参考見本'];
const TODAY = '2026-09-19';

describe('制作依頼シートの解釈（docs/metrics.md 制作依頼）', () => {
  it('日付は Date セル／yy/mm/dd(曜)／yyyy/m/d／m/d を YYYY-MM-DD にする', () => {
    expect(parseDateCell(new Date(2026, 8, 4), 2026)).toBe('2026-09-04');
    expect(parseDateCell('26/09/04(金)', 2026)).toBe('2026-09-04');
    expect(parseDateCell('2026/9/4', 2026)).toBe('2026-09-04');
    expect(parseDateCell('8/12', 2026)).toBe('2026-08-12');
    expect(parseDateCell('9/31', 2026)).toBeNull();
    expect(parseDateCell('', 2026)).toBeNull();
  });
  it('納期の自由記入: 本日希望＝依頼日、明日中＝依頼日+1、8/28希望＝日付、完成から1週間＝不明', () => {
    expect(parseDue('本日希望', '2026-09-17', TODAY)).toEqual({ dueDate: '2026-09-17', kind: 'today' });
    expect(parseDue('できれば明日中', '2026-09-17', TODAY)).toEqual({ dueDate: '2026-09-18', kind: 'tomorrow' });
    expect(parseDue('8/28希望', '2026-08-20', TODAY)).toEqual({ dueDate: '2026-08-28', kind: 'date' });
    expect(parseDue('完成から1週間', '2026-08-20', TODAY)).toEqual({ dueDate: null, kind: 'unknown' });
    expect(parseDue('', null, TODAY)).toEqual({ dueDate: null, kind: 'none' });
    expect(parseDue('本日希望', null, TODAY)).toEqual({ dueDate: TODAY, kind: 'today' });
  });
  it('状態: 完了／依頼／制作中／確認待ち／修正。空欄は内容があれば「依頼」、無ければ行ごと除外', () => {
    expect(normalizeStatus('完了', true)).toBe('done');
    expect(normalizeStatus('依頼', true)).toBe('requested');
    expect(normalizeStatus('制作中', true)).toBe('in_progress');
    expect(normalizeStatus('確認待ち', true)).toBe('review');
    expect(normalizeStatus('修正', true)).toBe('revise');
    expect(normalizeStatus('', true)).toBe('requested');
    expect(normalizeStatus('', false)).toBeNull();
  });
  it('行列から依頼一覧を作り、空行と NO. だけの行を除外する', () => {
    const rows = [
      ['広告画像作成プロセス', '', ''],
      header,
      ['001', '', '', '完了', '', '', '', '楽天', 'インスタ広告用', '', 'スーパーセール', '', '全商品', '', 'ポイントUP', '', '', ''],
      ['019', '三浦', '', '依頼', new Date(2026, 8, 16), '角南', '本日希望', '楽天セール', '25日用', 'ストーリー', '', '', 'スーツケース', '', '内容', '', '', ''],
      ['020', '', '', '', '26/09/17(木)', '角南', 'できれば明日中', 'Amazon広告', '通常広告', '', '', '', 'ジップ', '', 'リサイズ', '', '', ''],
      ['020', '', '', '', '26/09/17(木)', '角南', '明日中', 'Amazon広告', '通常広告', '', '', '', 'ノーマル', '', 'リサイズ', '', '', ''],
      ['026', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      [],
    ];
    const list = parseCreativeRequests(rows, TODAY);
    expect(list.map((r) => r.no)).toEqual(['001', '019', '020', '020']);
    expect(list[0].status).toBe('done');
    expect(list[1]).toMatchObject({ status: 'requested', designer: '三浦', requestedAt: '2026-09-16', dueDate: '2026-09-16', dueKind: 'today', requester: '角南' });
    expect(list[2]).toMatchObject({ status: 'requested', designer: '', requestedAt: '2026-09-17', dueDate: '2026-09-18', dueKind: 'tomorrow' });
    const s = summarizeCreativeRequests(list, TODAY);
    expect(s).toMatchObject({ total: 4, open: 3, done: 1, overdue: 3, dueToday: 0, dueUnknown: 0, unassigned: 2, duplicateNos: ['020'] });
    expect(s.byDesigner).toEqual([
      { designer: '（未定）', open: 2, overdue: 2 },
      { designer: '三浦', open: 1, overdue: 1 },
    ]);
    expect(sortOpen(list, TODAY).map((r) => r.no)).toEqual(['019', '020', '020']);
  });
  it('見出し行が無ければ空（推測で埋めない）', () => {
    expect(parseCreativeRequests([['a', 'b'], ['c', 'd']], TODAY)).toEqual([]);
  });
});
