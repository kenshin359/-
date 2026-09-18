import { describe, expect, it } from 'vitest';
import { computeBoardStats, TaskInput, type TaskItem } from '../tasks';
import { docKind } from '../documents';

const base: TaskItem = {
  id: '1', source: 'local', team: 'CS', assignee: '笹本', title: 't', doneDef: 'd', priority: 'P2',
  impact: '○ 間接（計測・基盤）', due: null, status: '未着手', yanai: '', memo: '', updatedAt: null,
};

describe('computeBoardStats（朝礼台本と同じ観点）', () => {
  const now = new Date('2026-09-18T03:00:00Z'); // JST 12:00 9/18
  it('期限超過・本日期限・P1未完了・昨日完了を数える', () => {
    const tasks: TaskItem[] = [
      { ...base, id: 'a', due: '2026-09-16', priority: 'P1' },
      { ...base, id: 'b', due: '2026-09-18' },
      { ...base, id: 'c', due: '2026-09-25', priority: 'P1' },
      { ...base, id: 'd', due: '2026-09-10', status: '完了', updatedAt: '2026-09-17T09:00:00+09:00' },
      { ...base, id: 'e', due: '2026-09-10', status: '完了', updatedAt: '2026-09-15T09:00:00+09:00' },
    ];
    const s = computeBoardStats(tasks, now);
    expect(s.today).toBe('2026-09-18');
    expect(s.overdue).toBe(1);
    expect(s.dueToday).toBe(1);
    expect(s.p1Open).toBe(2);
    expect(s.doneYesterday).toBe(1);
    expect(s.open).toBe(3);
  });
  it('完了タスクは期限超過に数えない', () => {
    const s = computeBoardStats([{ ...base, due: '2026-01-01', status: '完了' }], now);
    expect(s.overdue).toBe(0);
  });
});

describe('TaskInput（柳井ルール）', () => {
  const ok = { title: 'x', team: 'CS', assignee: '笹本', doneDef: '未返信0件', priority: 'P1', impact: '◎ 売上に直結', due: '2026-09-30' };
  it('期限と完了の定義が無いと登録できない', () => {
    expect(TaskInput.safeParse(ok).success).toBe(true);
    expect(TaskInput.safeParse({ ...ok, due: '' }).success).toBe(false);
    expect(TaskInput.safeParse({ ...ok, doneDef: '' }).success).toBe(false);
  });
});

describe('docKind（URLから資料の種類）', () => {
  it('Googleドライブの各種URLを判定する', () => {
    expect(docKind('https://drive.google.com/drive/folders/1abc')).toBe('folder');
    expect(docKind('https://docs.google.com/spreadsheets/d/1/edit')).toBe('sheet');
    expect(docKind('https://docs.google.com/presentation/d/1/edit')).toBe('slide');
    expect(docKind('https://docs.google.com/document/d/1/edit')).toBe('doc');
    expect(docKind('https://example.com/a.PDF')).toBe('pdf');
    expect(docKind('https://example.com/')).toBe('link');
    expect(docKind('not a url')).toBe('link');
  });
});
