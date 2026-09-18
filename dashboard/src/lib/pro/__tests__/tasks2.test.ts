import { describe, expect, it } from 'vitest';
import {
  activityDays,
  classifyStuck,
  computeBottlenecks,
  displayStatusOf,
  mergeTask,
  priorityCode,
  priorityLabel,
  priorityLevel,
  projectCodeFromName,
  projectProgress,
  statusMatrix,
  type Task2Item,
} from '../tasks2';
import { composeInterimDraft } from '../reports';
import type { TaskItem } from '../../tasks';

const now = new Date('2026-09-18T03:00:00Z'); // JST 9/18 12:00

const baseItem: TaskItem = {
  id: '1', source: 'local', team: 'CS', assignee: '笹本', title: 't', doneDef: 'd', priority: 'P2',
  impact: '○ 間接（計測・基盤）', due: null, status: '未着手', yanai: '', memo: '', updatedAt: '2026-09-18T00:00:00+09:00',
};

function task(over: Partial<Task2Item> & Partial<TaskItem>): Task2Item {
  const merged = mergeTask({ ...baseItem, ...over }, undefined, new Map());
  const out = { ...merged, ...over } as Task2Item;
  out.displayStatus = displayStatusOf(out.status, out.holdReason);
  return out;
}

describe('優先度の相互変換（緊急/高/中/低 ⇄ P1〜P4）', () => {
  it('P1〜P4 と日本語を相互に変換する', () => {
    expect(priorityLevel('P1')).toBe('緊急');
    expect(priorityLevel('P4')).toBe('低');
    expect(priorityCode('高')).toBe('P2');
    expect(priorityCode('中')).toBe('P3');
    expect(priorityLevel('P9')).toBeNull();
    expect(priorityCode('最強')).toBeNull();
  });
  it('表示は両方併記する', () => {
    expect(priorityLabel('P1')).toBe('P1 緊急');
    expect(priorityLabel('')).toBe('—');
  });
});

describe('表示状態（保留はローカルの理由で決まる）', () => {
  it('確認待ち＋保留理由 → 保留、完了なら保留にならない', () => {
    expect(displayStatusOf('確認待ち', '見積待ち')).toBe('保留');
    expect(displayStatusOf('進行中', '  ')).toBe('進行中');
    expect(displayStatusOf('完了', '見積待ち')).toBe('完了');
  });
  it('mergeTask は部署コードと優先度ラベルを付ける', () => {
    const t = mergeTask(baseItem, undefined, new Map());
    expect(t.teamCode).toBe('cs');
    expect(t.teamName).toBe('CS・物流');
    expect(t.priorityLevel).toBe('高');
    expect(t.progress).toBe(0);
    // Kintone表記に無いチームは担当者の所属で補う
    const u = mergeTask({ ...baseItem, team: '', assignee: '角南' }, undefined, new Map());
    expect(u.teamCode).toBe('ads');
  });
});

describe('ボトルネック判定', () => {
  it('期限超過・確認待ち滞留（3日超）・保留を理由付きで拾う', () => {
    const overdue = task({ id: 'a', due: '2026-09-15' });
    const stale = task({ id: 'b', status: '確認待ち', updatedAt: '2026-09-13T09:00:00+09:00' });
    const fresh = task({ id: 'c', status: '確認待ち', updatedAt: '2026-09-16T09:00:00+09:00' });
    const held = task({ id: 'd', status: '確認待ち', holdReason: '仕入先の回答待ち', lastActivityAt: '2026-09-10T09:00:00+09:00' });
    const done = task({ id: 'e', due: '2026-01-01', status: '完了' });
    expect(classifyStuck(overdue, now)).toMatchObject({ reasons: ['期限超過'], days: 3 });
    expect(classifyStuck(stale, now)?.reasons).toEqual(['確認待ち滞留']);
    expect(classifyStuck(fresh, now)).toBeNull();
    expect(classifyStuck(held, now)).toMatchObject({ reasons: ['保留'], days: 8 });
    expect(classifyStuck(done, now)).toBeNull();
    expect(activityDays(stale, now)).toBe(5);
  });
  it('担当者別・部署別の負荷と「止まっている仕事」を日数順に並べる', () => {
    const tasks = [
      task({ id: 'a', assignee: '笹本', due: '2026-09-15' }),
      task({ id: 'b', assignee: '笹本', status: '進行中', updatedAt: '2026-09-18T09:00:00+09:00' }),
      task({ id: 'c', assignee: '角南', team: '広告', status: '確認待ち', updatedAt: '2026-09-10T09:00:00+09:00', due: '2026-09-17' }),
      task({ id: 'd', assignee: '角南', team: '広告', status: '完了' }),
    ];
    const b = computeBottlenecks(tasks, now);
    expect(b.today).toBe('2026-09-18');
    expect(b.stuck.map((s) => s.task.id)).toEqual(['c', 'a']);
    expect(b.stuck[0].reasons).toEqual(['期限超過', '確認待ち滞留']);
    expect(b.stuck[0].days).toBe(8);
    const sasa = b.byAssignee.find((r) => r.key === '笹本')!;
    expect(sasa).toMatchObject({ open: 2, overdue: 1, waitingStale: 0, held: 0, lastActivityDays: 0 });
    const sunami = b.byAssignee.find((r) => r.key === '角南')!;
    expect(sunami).toMatchObject({ open: 1, overdue: 1, waitingStale: 1, lastActivityDays: 8 });
    expect(b.byAssignee[0].key).toBe('角南'); // 止まっている件数が多い順
    expect(b.byTeam.map((r) => r.key)).toEqual(['ads', 'cs']); // TEAM_DEFS の並び
  });
  it('部署×状態マトリクス', () => {
    const m = statusMatrix([
      task({ id: 'a', status: '未着手' }),
      task({ id: 'b', status: '確認待ち', holdReason: 'x' }),
      task({ id: 'c', team: '広告', assignee: '角南', status: '完了' }),
    ]);
    expect(m.map((r) => r.label)).toEqual(['広告', 'CS・物流']);
    expect(m[1].counts).toEqual({ 未着手: 1, 進行中: 0, 確認待ち: 0, 保留: 1, 完了: 0 });
    expect(m[0].total).toBe(1);
  });
});

describe('プロジェクト', () => {
  it('進捗は平均（完了は100扱い）、タスクなしは null', () => {
    expect(projectProgress([])).toBeNull();
    expect(projectProgress([{ progress: 40, displayStatus: '進行中' }, { progress: 0, displayStatus: '完了' }])).toBe(70);
  });
  it('コードは名前から（英数字はスラッグ、日本語のみは prj-日付）', () => {
    expect(projectCodeFromName('Amazon Sale 2026')).toBe('amazon-sale-2026');
    expect(projectCodeFromName('楽天スーパーSALE 9月', now)).toBe('sale-9');
    expect(projectCodeFromName('在庫圧縮', now)).toBe('prj-20260918'); // 英数字が3文字未満なら日付
    expect(projectCodeFromName('ＲＰＰ強化', now)).toBe('rpp'); // 全角英字は NFKC で半角に
  });
});

describe('中間報告の自動生成（決定的テンプレート）', () => {
  it('部署のタスク状況とアラートから5項目を組み立てる', () => {
    const tasks = [
      task({ id: 'a', team: '広告', assignee: '角南', title: 'CPA改善', due: '2026-09-15', priority: 'P1' }),
      task({ id: 'b', team: '広告', assignee: '角南', title: '確認依頼中', status: '確認待ち', updatedAt: '2026-09-10T09:00:00+09:00' }),
      task({ id: 'c', team: '広告', assignee: '角南', title: '先週完了', status: '完了', updatedAt: '2026-09-16T09:00:00+09:00', doneDef: 'CPA 4,500以下' }),
      task({ id: 'd', team: 'CS', title: '他部署' }),
    ];
    const d = composeInterimDraft('ads', tasks, [{ level: 'red', title: '期限超過', detail: '1件', teamCode: 'ads' }, { level: 'yellow', title: '他部署の件', detail: null, teamCode: 'cs' }], now);
    expect(d.type).toBe('interim');
    expect(d.periodFrom).toBe('2026-09-12');
    expect(d.periodTo).toBe('2026-09-18');
    expect(d.title).toContain('広告 中間報告');
    expect(d.body.numbers).toContain('未完了 2件（期限超過 1・確認待ち 1・保留 0）');
    expect(d.body.numbers).toContain('今週完了 1件');
    expect(d.body.numbers).toContain('未取得'); // 売上は推測で埋めない
    expect(d.body.learned).toContain('先週完了');
    expect(d.body.next).toContain('CPA改善');
    expect(d.body.issues).toContain('🔴 期限超過');
    expect(d.body.issues).not.toContain('他部署の件');
    expect(d.body.requests).toContain('「確認依頼中」の確認をお願いします');
  });
});
