// AI改善提案の純関数の検算。数値は架空の固定データ。
import { describe, expect, it } from 'vitest';
import { excludeDemo, isDemoProposal, isProposalStatus, parseFacts, sortProposals, summarizeProposals, type ProposalLike } from '../proposals';

function p(id: string, o: Partial<ProposalLike> = {}): ProposalLike {
  return { id, source: 'rule', title: `提案${id}`, priority: 2, status: 'open', createdAt: '2026-09-10T00:00:00.000Z', ...o };
}

describe('AI改善提案', () => {
  it('デモ判定は「（デモ）」接頭辞（シードの命名規約）。実データ集計から排他', () => {
    expect(isDemoProposal({ title: '（デモ）広告費率が閾値20%を超過' })).toBe(true);
    expect(isDemoProposal({ title: ' （デモ）前後に空白' })).toBe(true);
    expect(isDemoProposal({ title: '広告費率が閾値20%を超過' })).toBe(false);
    const list = [p('a', { title: '（デモ）x' }), p('b')];
    expect(excludeDemo(list).map((x) => x.id)).toEqual(['b']);
  });
  it('状態の検証と件数', () => {
    expect(isProposalStatus('open')).toBe(true);
    expect(isProposalStatus('done')).toBe(false);
    const s = summarizeProposals([p('1'), p('2', { status: 'adopted' }), p('3', { status: 'held' }), p('4', { status: 'rejected' }), p('5', { status: 'weird' })]);
    expect(s).toEqual({ open: 1, adopted: 1, held: 1, rejected: 1, other: 1, total: 5 });
  });
  it('根拠JSONの表示化（文字列以外はJSON化・壊れたJSONは原文）', () => {
    expect(parseFacts('{"広告費率":"21.4%","閾値":"20%","日数":3}')).toEqual({ 広告費率: '21.4%', 閾値: '20%', 日数: '3' });
    expect(parseFacts('not json')).toEqual({ 根拠: 'not json' });
    expect(parseFacts('')).toEqual({});
    expect(parseFacts('[1,2]')).toEqual({ 根拠: '[1,2]' });
  });
  it('並び順: 未対応→保留→採用→却下、同状態は優先度→新しい順', () => {
    const list = [
      p('rej', { status: 'rejected' }),
      p('open-p2-old', { priority: 2, createdAt: '2026-09-01T00:00:00.000Z' }),
      p('adopt', { status: 'adopted' }),
      p('open-p1', { priority: 1 }),
      p('held', { status: 'held' }),
      p('open-p2-new', { priority: 2, createdAt: '2026-09-15T00:00:00.000Z' }),
    ];
    expect(sortProposals(list).map((x) => x.id)).toEqual(['open-p1', 'open-p2-new', 'open-p2-old', 'held', 'adopt', 'rej']);
  });
});
