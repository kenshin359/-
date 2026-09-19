import { describe, expect, it } from 'vitest';
import { cellBool, classifyConsult, detectSurveyColumns, isPlanOverdue, parseSurveyTabs, summarizeSurvey } from '../survey';

const TODAY = '2026-09-19';
// 見出しは長文なので先頭の数文字で列を特定する（実物のシートに合わせた語順）
const HEADER = [
  'タイムスタンプ',
  '現在の仕事量・内容について、感じていることがあれば教えてください',
  '最近の社内雰囲気・コミュニケーションについて、気になることはありますか',
  '仕事の悩みや困っていることを相談できる人はいますか',
  '社内の社内ルールや制度について、改善したい点はありますか',
  '社内の備品について、必要なものや不足しているものはありますか',
  'その他会社への提案・要望があれば自由にお書きください',
];
const HEADER_WITH_PROGRESS = [...HEADER, '具体策', '対応・全体共有'];

// テスト用の回答テキスト（本文が出力に漏れていないかの検査にも使う）
const BODY = ['テスト回答A_仕事量', 'テスト回答B_雰囲気', 'テスト回答D_ルール', 'テスト回答E_備品', 'テスト回答F_提案', 'テスト具体策X'];

const rawTab = [
  ['フォームの回答', '', '', '', '', '', ''],
  HEADER,
  [new Date(2026, 6, 30, 10, 12, 33), BODY[0], BODY[1], 'いる(仕事の悩みがある)', BODY[2], '', BODY[4]],
  [new Date(2026, 8, 10, 9, 0, 0), '', '', 'いない（仕事の悩みはない）', '', BODY[3], ''],
  ['', '', '', '', '', '', ''],
];
const progressTab = [
  HEADER_WITH_PROGRESS,
  [new Date(2026, 6, 30, 10, 12, 33), BODY[0], BODY[1], 'いる(仕事の悩みがある)', BODY[2], '', BODY[4], BODY[5], true],
  [new Date(2026, 8, 1, 18, 30, 0), '', '', '', '', '', '', '', 'FALSE'],
  [new Date(2026, 8, 6, 8, 0, 0), '', '', '', '', '', '', BODY[5], 'FALSE'],
];
const otherTab = [['集計メモ', '件数'], ['仕事量', 3]];

describe('社内アンケートの集計（docs/metrics.md 社内アンケート）', () => {
  it('見出しの先頭数文字で6設問と具体策・対応列を特定し、タイムスタンプ見出しの無いタブは対象外', () => {
    const det = detectSurveyColumns(progressTab);
    expect(det?.headerIndex).toBe(0);
    expect(det?.cols).toEqual({
      timestamp: 0,
      questions: { workload: 1, atmosphere: 2, consult: 3, rules: 4, supplies: 5, proposal: 6 },
      plan: 7,
      handled: 8,
    });
    expect(detectSurveyColumns(rawTab)?.cols.plan).toBeNull();
    expect(detectSurveyColumns(otherTab)).toBeNull();
  });

  it('相談相手の選択肢を分類する（本文は返さない）', () => {
    expect(classifyConsult('いる(仕事の悩みがある)')).toBe('yes_worry');
    expect(classifyConsult('いる（仕事の悩みはない）')).toBe('yes_fine');
    expect(classifyConsult('いない(仕事の悩みがある)')).toBe('no_worry');
    expect(classifyConsult('いない（仕事の悩みはない）')).toBe('no_fine');
    expect(classifyConsult('いる')).toBe('yes');
    expect(classifyConsult('いない')).toBe('no');
    expect(classifyConsult('わからない')).toBe('other');
    expect(classifyConsult('')).toBe('blank');
    expect(cellBool(true)).toBe(true);
    expect(cellBool('TRUE')).toBe(true);
    expect(cellBool('FALSE')).toBe(false);
    expect(cellBool('')).toBe(false);
  });

  it('全タブを走査し、タイムスタンプ＋設問1が同一の行は1件に寄せる（具体策・対応済みはどちらかにあれば採用）', () => {
    const list = parseSurveyTabs([rawTab, progressTab, otherTab], TODAY);
    // 7/30 は両タブにあり1件、9/10・9/1・9/6 は各1件 → 4件
    expect(list.map((r) => r.date)).toEqual(['2026-07-30', '2026-09-01', '2026-09-06', '2026-09-10']);
    const first = list[0];
    expect(first.answered).toEqual({ workload: true, atmosphere: true, consult: true, rules: true, supplies: false, proposal: true });
    expect(first.consult).toBe('yes_worry');
    expect(first.hasPlan).toBe(true);
    expect(first.handled).toBe(true);
    expect(first.daysSince).toBe(51);
    const sep10 = list[3];
    expect(sep10.answered.supplies).toBe(true);
    expect(sep10.consult).toBe('no_fine');
    expect(sep10.hasPlan).toBe(false);
    expect(sep10.handled).toBe(false);
    expect(sep10.daysSince).toBe(9);
  });

  it('対応遅れ = 回答から14日を超えて具体策なし（14日ちょうどは遅れでない）', () => {
    const base = { answered: { workload: true, atmosphere: false, consult: false, rules: false, supplies: false, proposal: false }, consult: 'blank' as const, handled: false };
    expect(isPlanOverdue({ ...base, date: '2026-09-05', daysSince: 14, hasPlan: false })).toBe(false);
    expect(isPlanOverdue({ ...base, date: '2026-09-04', daysSince: 15, hasPlan: false })).toBe(true);
    expect(isPlanOverdue({ ...base, date: '2026-09-04', daysSince: 15, hasPlan: true })).toBe(false);
    expect(isPlanOverdue({ ...base, date: null, daysSince: null, hasPlan: false })).toBe(false);
  });

  it('サマリー: 総回答・月別・設問別回答あり・相談相手の内訳・具体策あり・対応済み・未対応・対応遅れ', () => {
    const list = parseSurveyTabs([rawTab, progressTab], TODAY);
    const s = summarizeSurvey(list, TODAY);
    expect(s.total).toBe(4);
    expect(s.byMonth).toEqual([
      { month: '2026-07', count: 1, withPlan: 1, handled: 1, pending: 0 },
      { month: '2026-09', count: 3, withPlan: 1, handled: 0, pending: 3 },
    ]);
    expect(s.noDate).toBe(0);
    expect(s.byQuestion.map((q) => [q.key, q.answered])).toEqual([
      ['workload', 1],
      ['atmosphere', 1],
      ['consult', 2],
      ['rules', 1],
      ['supplies', 1],
      ['proposal', 1],
    ]);
    expect(s.consult.yes_worry).toBe(1);
    expect(s.consult.no_fine).toBe(1);
    expect(s.consult.blank).toBe(2);
    expect(s.withPlan).toBe(2);
    expect(s.withoutPlan).toBe(2);
    expect(s.handled).toBe(1);
    expect(s.pending).toBe(3);
    // 具体策なし: 9/1（18日経過→遅れ）・9/10（9日→まだ）
    expect(s.overdue).toBe(1);
    expect(s.planDeadlineDays).toBe(14);
  });

  it('出力に回答本文・具体策の本文が含まれない', () => {
    const list = parseSurveyTabs([rawTab, progressTab], TODAY);
    const json = JSON.stringify({ list, summary: summarizeSurvey(list, TODAY) });
    for (const b of BODY) expect(json).not.toContain(b);
    expect(json).not.toContain('いる(仕事の悩みがある)');
  });
});
