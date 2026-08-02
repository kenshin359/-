// 業務タスクの変換・集計ロジックのテスト（ネットワーク不要）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordToTask,
  buildDataset,
  buildDigest,
  formatDigest,
  diffEvents,
  formatEvents,
  TEAMS,
} from '../lib/taskData.js';

function task(over = {}) {
  return {
    id: over.id || 't1',
    title: over.title || 'タスク',
    cat: 'doc',
    dept: over.dept || 'cs',
    member: 'm1',
    memberName: over.memberName || '笹本',
    status: over.status || 'todo',
    prio: over.prio || '中',
    key: over.key || '2026-08-10',
  };
}

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

// ── 進捗の随時通知（diffEvents / formatEvents）──
test('diffEvents: 未着手→進行中 で「着手」を通知', () => {
  const prev = { t1: { status: 'todo', key: '2026-08-10', flags: {} } };
  const { events } = diffEvents(prev, [task({ status: 'doing' })], { todayKey: '2026-08-05' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'start');
});

test('diffEvents: →完了 で「完了」を通知', () => {
  const prev = { t1: { status: 'doing', key: '2026-08-10', flags: {} } };
  const { events } = diffEvents(prev, [task({ status: 'done' })], { todayKey: '2026-08-05' });
  assert.equal(events[0].type, 'done');
});

test('diffEvents: 期限超過で「遅延」を通知し、次回は再通知しない', () => {
  const prev = { t1: { status: 'todo', key: '2026-08-01', flags: { overdue: false } } };
  const cur = [task({ status: 'todo', key: '2026-08-01' })];
  const r1 = diffEvents(prev, cur, { todayKey: '2026-08-05' });
  assert.equal(r1.events.filter((e) => e.type === 'overdue').length, 1);
  // 次回は前回フラグ(overdue:true)により再通知されない
  const r2 = diffEvents(r1.next, cur, { todayKey: '2026-08-05' });
  assert.equal(r2.events.filter((e) => e.type === 'overdue').length, 0);
});

test('diffEvents: 未着手のまま期限が近いと「停滞」を通知', () => {
  const prev = { t1: { status: 'todo', key: '2026-08-06', flags: {} } };
  const { events } = diffEvents(prev, [task({ status: 'todo', key: '2026-08-06' })], { todayKey: '2026-08-05', stallDays: 2 });
  const stall = events.find((e) => e.type === 'stall');
  assert.ok(stall);
  assert.equal(stall.days, 1);
});

test('diffEvents: 初回相当（prev空）でも現状から立ち上がりを拾える', () => {
  const { events, next } = diffEvents({}, [task({ status: 'doing' })], { todayKey: '2026-08-05' });
  assert.equal(events[0].type, 'start');
  assert.equal(next.t1.status, 'doing');
});

test('formatEvents: 変化が無ければ null', () => {
  assert.equal(formatEvents([], { todayKey: '2026-08-05' }), null);
});

test('formatEvents: 種別ごとに見出しと担当・チームを出す', () => {
  const events = [
    { type: 'start', t: task({ title: '着手A', status: 'doing', dept: 'ad', memberName: '角南' }) },
    { type: 'overdue', t: task({ title: '遅延B', status: 'todo', key: '2026-08-01', dept: 'lp', memberName: '黒葛原' }) },
  ];
  const text = formatEvents(events, { todayKey: '2026-08-05' });
  assert.match(text, /🚀 着手/);
  assert.match(text, /⚠ 遅延/);
  assert.match(text, /着手A（角南 \/ 広告運用チーム）/);
  assert.match(text, /遅延B（黒葛原 \/ LPチーム）/);
});
