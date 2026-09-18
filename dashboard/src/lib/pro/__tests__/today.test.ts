import { describe, expect, it } from 'vitest';
import type { TaskItem } from '../../tasks';
import { buildTodaySections, resolveIdentity, teamStatusFor } from '../today';
import { isWaitingStale, judgeKpi, memberLoadLabel, teamCounts } from '../team-dashboard';
import { teamByCode } from '../teams';

const base: TaskItem = {
  id: '1', source: 'local', team: '広告', assignee: '角南', title: 't', doneDef: 'd', priority: 'P2',
  impact: '○ 間接（計測・基盤）', due: null, status: '未着手', yanai: '', memo: '', updatedAt: null,
};
const today = '2026-09-18';

describe('今日やること: 本人の特定', () => {
  it('kintoneName を優先し、空白の違いは無視する', () => {
    const id = resolveIdentity({ id: 'u1', name: '管理者デモ', kintoneName: '角 南' }, ['角南', '北野']);
    expect(id.names).toEqual(['角南']);
  });
  it('kintoneName が無ければログイン名の前方一致', () => {
    const id = resolveIdentity({ id: 'u1', name: '角南 太郎', kintoneName: null }, ['角南', '北野']);
    expect(id.names).toEqual(['角南']);
  });
  it('どちらも一致しなければ未特定（推測しない）', () => {
    const id = resolveIdentity({ id: 'u1', name: '管理者デモ', kintoneName: null }, ['角南', '北野']);
    expect(id.names).toEqual([]);
  });
});

describe('今日やること: 区分は固定の優先順で、同じタスクは一度だけ', () => {
  const me = { names: ['角南'], userId: 'me' };
  it('期限超過 → 本日期限 → 確認待ち → 依頼 → P1 → 3日以内', () => {
    const tasks: TaskItem[] = [
      { ...base, id: 'a', due: '2026-09-16', priority: 'P1', status: '確認待ち' }, // 超過（P1・確認待ちでも超過が先）
      { ...base, id: 'b', due: '2026-09-18', status: '確認待ち' }, // 本日
      { ...base, id: 'c', due: '2026-09-30', status: '確認待ち' }, // 確認待ち
      { ...base, id: 'd', due: '2026-09-30' }, // 依頼（requestedBy 上司）
      { ...base, id: 'e', due: '2026-09-30', priority: 'P1' }, // P1
      { ...base, id: 'f', due: '2026-09-21' }, // 3日以内
      { ...base, id: 'g', due: '2026-09-22' }, // 4日後 → どこにも入らない
      { ...base, id: 'h', due: '2026-09-10', status: '完了' }, // 完了は除外
      { ...base, id: 'i', due: '2026-09-10', assignee: '北野' }, // 他人
    ];
    const requested = { byTaskId: new Map([['d', { userId: 'boss', name: '北野' }]]) };
    const { sections, counts } = buildTodaySections(tasks, me, today, requested);
    expect(sections.map((s) => [s.key, s.tasks.map((t) => t.id)])).toEqual([
      ['overdue', ['a']],
      ['dueToday', ['b']],
      ['waiting', ['c']],
      ['requested', ['d']],
      ['p1', ['e']],
      ['soon', ['f']],
    ]);
    expect(sections.find((s) => s.key === 'requested')!.tasks[0].requestedBy).toBe('北野');
    expect(counts.openTotal).toBe(7);
  });
  it('自分が依頼して確認待ちになった他人のタスクは「確認待ち」に自分宛として入る', () => {
    const tasks: TaskItem[] = [{ ...base, id: 'x', assignee: '黒葛原', status: '確認待ち', due: '2026-10-01' }];
    const requested = { byTaskId: new Map([['x', { userId: 'me', name: '角南' }]]) };
    const { sections } = buildTodaySections(tasks, me, today, requested);
    expect(sections[0].key).toBe('waiting');
    expect(sections[0].tasks[0].isOthers).toBe(true);
  });
  it('Kintone タスクは依頼元が無いので「上司からの依頼」に入らない', () => {
    const tasks: TaskItem[] = [{ ...base, id: '7', source: 'kintone', due: '2026-10-01' }];
    const requested = { byTaskId: new Map([['7', { userId: 'boss', name: '北野' }]]) };
    const { sections } = buildTodaySections(tasks, me, today, requested);
    expect(sections.find((s) => s.key === 'requested')).toBeUndefined();
  });
  it('自チームの状況は Kintone チーム表記で数える', () => {
    const tasks: TaskItem[] = [
      { ...base, id: 'a', due: '2026-09-01' },
      { ...base, id: 'b', status: '確認待ち' },
      { ...base, id: 'c', team: 'LP' },
    ];
    expect(teamStatusFor(tasks, teamByCode('ads'), today)).toEqual({ code: 'ads', name: '広告', open: 2, overdue: 1, waiting: 1 });
    expect(teamStatusFor(tasks, undefined, today)).toBeNull();
  });
});

describe('部署ダッシュボード: 集計と判定', () => {
  const now = new Date('2026-09-18T03:00:00Z');
  it('確認待ち滞留は3日超・7日以内の期限を数える', () => {
    const tasks: TaskItem[] = [
      { ...base, id: 'a', status: '確認待ち', updatedAt: '2026-09-10T00:00:00Z' }, // 滞留
      { ...base, id: 'b', status: '確認待ち', updatedAt: '2026-09-17T00:00:00Z' }, // 滞留ではない
      { ...base, id: 'c', due: '2026-09-24' }, // 7日以内（今日から6日後）
      { ...base, id: 'd', due: '2026-09-25' }, // 範囲外
      { ...base, id: 'e', assignee: '' },
    ];
    expect(isWaitingStale(tasks[0], now)).toBe(true);
    expect(isWaitingStale(tasks[1], now)).toBe(false);
    const c = teamCounts(tasks, today, now);
    expect(c).toEqual({ open: 5, overdue: 0, waiting: 2, waitingStale: 1, dueThisWeek: 1, noAssignee: 1 });
  });
  it('担当者の負荷は TaskBoard と同じ境界', () => {
    expect(memberLoadLabel(2, 1).tone).toBe('danger');
    expect(memberLoadLabel(8, 0).tone).toBe('warn');
    expect(memberLoadLabel(3, 0).tone).toBe('ok');
    expect(memberLoadLabel(5, 0).tone).toBe('none');
  });
  it('KPI は目標が無ければ未設定、方向に応じて判定', () => {
    const k = { direction: 'down', targetValue: 15, warnThreshold: 20, dangerThreshold: null };
    expect(judgeKpi(k, null).judgment).toBe('none');
    expect(judgeKpi({ ...k, targetValue: null }, 10).judgment).toBe('none');
    expect(judgeKpi(k, 14).judgment).toBe('ok');
    expect(judgeKpi(k, 18).judgment).toBe('warn');
    expect(judgeKpi(k, 25).judgment).toBe('danger');
    expect(judgeKpi({ direction: 'up', targetValue: 100, warnThreshold: null, dangerThreshold: null }, 90).judgment).toBe('danger');
  });
});
