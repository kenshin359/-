// 業務タスクの変換・集計ロジックのテスト（ネットワーク不要）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordToTask,
  buildDataset,
  buildDigest,
  formatDigest,
  TEAMS,
} from '../lib/taskData.js';

function rec(fields) {
  const r = {};
  for (const [k, v] of Object.entries(fields)) r[k] = { value: v };
  return r;
}

test('recordToTask: 日本語ラベルを内部IDへ変換する', () => {
  const t = recordToTask(
    rec({
      task_title: '広告レビュー',
      assignee: '黒葛原',
      team: '広告運用チーム',
      category: '分析',
      priority: '高',
      status: '進行中',
      due_date: '2026-08-15',
    })
  );
  assert.equal(t.title, '広告レビュー');
  assert.equal(t.dept, 'ad');
  assert.equal(t.cat, 'analyze');
  assert.equal(t.status, 'doing');
  assert.equal(t.prio, '高');
  assert.equal(t.key, '2026-08-15');
  assert.equal(t.mo, 7); // 0始まり
  assert.equal(t.memberName, '黒葛原');
});

test('recordToTask: タスク名や期日が空なら null', () => {
  assert.equal(recordToTask(rec({ task_title: '', due_date: '2026-08-01' })), null);
  assert.equal(recordToTask(rec({ task_title: 'あり', due_date: '' })), null);
});

test('recordToTask: 未知のチーム/種別/ステータスは既定値に寄せる', () => {
  const t = recordToTask(
    rec({ task_title: 'x', assignee: 'A', team: '謎', category: '謎', status: '謎', priority: '謎', due_date: '2026-08-01' })
  );
  assert.equal(t.dept, 'honbu');
  assert.equal(t.cat, 'doc');
  assert.equal(t.status, 'todo');
  assert.equal(t.prio, '中');
});

test('buildDataset: 兼務者は複数チームに所属としてまとまる', () => {
  const tasks = [
    recordToTask(rec({ task_title: 'a', assignee: '黒葛原', team: '広告運用チーム', due_date: '2026-08-10' })),
    recordToTask(rec({ task_title: 'b', assignee: '黒葛原', team: 'LPチーム', due_date: '2026-08-11' })),
  ];
  const ds = buildDataset(tasks, '2026-08-01T00:00:00Z');
  assert.equal(ds.members.length, 1);
  assert.deepEqual(ds.members[0].teams.sort(), ['ad', 'lp']);
  assert.equal(ds.teams.length, TEAMS.length);
});

test('buildDigest: 遅延・本日締切を正しく分類する', () => {
  const tasks = [
    recordToTask(rec({ task_title: '遅延中', assignee: 'A', team: 'CSチーム', status: '進行中', due_date: '2026-08-01' })),
    recordToTask(rec({ task_title: '今日締切', assignee: 'B', team: 'CSチーム', status: '未着手', due_date: '2026-08-05' })),
    recordToTask(rec({ task_title: '完了済', assignee: 'C', team: 'CSチーム', status: '完了', due_date: '2026-08-01' })),
    recordToTask(rec({ task_title: '未来', assignee: 'D', team: 'CSチーム', status: '未着手', due_date: '2026-08-20' })),
  ];
  const dg = buildDigest(tasks, { todayKey: '2026-08-05' });
  assert.equal(dg.overall.overdue.length, 1); // 遅延中（完了済は除外）
  assert.equal(dg.overall.dueToday.length, 1); // 今日締切
  const cs = dg.teams.find((t) => t.id === 'cs');
  assert.equal(cs.overdue[0].title, '遅延中');
  assert.equal(cs.dueToday[0].title, '今日締切');
});

test('formatDigest: 見出しと件数、遅延マークを含む', () => {
  const tasks = [
    recordToTask(rec({ task_title: '遅延タスク', assignee: 'A', team: 'LPチーム', status: '遅延', due_date: '2026-08-01' })),
  ];
  const dg = buildDigest(tasks, { todayKey: '2026-08-05' });
  const text = formatDigest(dg, { title: 'テスト見出し' });
  assert.match(text, /テスト見出し/);
  assert.match(text, /遅延 1件/);
  assert.match(text, /⚠.*遅延タスク/);
});

test('formatDigest: 締切も遅延も無ければ、その旨を返す', () => {
  const tasks = [
    recordToTask(rec({ task_title: '完了', assignee: 'A', team: 'LPチーム', status: '完了', due_date: '2026-08-01' })),
  ];
  const dg = buildDigest(tasks, { todayKey: '2026-08-05' });
  const text = formatDigest(dg);
  assert.match(text, /本日締切・遅延のタスクはありません/);
});
