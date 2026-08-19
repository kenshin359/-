// タスク報告コマンドの解析＋ストア適用のテスト（ネットワーク不要）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../lib/taskCommands.js';
import { emptyStore, applyCommand, storeTasksToCalendar } from '../lib/reportStore.js';

const TODAY = '2026-08-05';

test('parseCommand: 登録＋箇条書き', () => {
  const c = parseCommand('登録\n・提案資料作成（8/15まで）\n・見積もり送付', { todayKey: TODAY });
  assert.equal(c.type, 'register');
  assert.equal(c.items.length, 2);
  assert.equal(c.items[0].title, '提案資料作成');
  assert.equal(c.items[0].due, '2026-08-15');
  assert.equal(c.items[1].title, '見積もり送付');
});

test('parseCommand: 完了（インライン）と着手', () => {
  assert.equal(parseCommand('完了 提案資料作成', {}).type, 'done');
  assert.equal(parseCommand('完了 提案資料作成', {}).items[0].title, '提案資料作成');
  assert.equal(parseCommand('着手\n・見積もり送付', {}).type, 'start');
});

test('parseCommand: 退勤', () => {
  assert.equal(parseCommand('退勤', {}).type, 'leave');
  assert.equal(parseCommand('お疲れさまでした', {}).type, 'leave');
});

test('parseCommand: コマンドでない通常会話は null', () => {
  assert.equal(parseCommand('今日は暑いですね', {}), null);
  assert.equal(parseCommand('', {}), null);
});

test('applyCommand: 登録→タスクが増え、確認文を返す', () => {
  const store = emptyStore();
  const cmd = parseCommand('登録\n・提案資料作成（8/15まで）\n・見積もり送付', { todayKey: TODAY });
  const res = applyCommand(store, { sender: '角南', messageId: 1, dateKey: TODAY, command: cmd, todayKey: TODAY });
  assert.equal(res.changed, true);
  assert.equal(store.tasks.length, 2);
  assert.equal(store.tasks[0].memberName, '角南');
  assert.match(res.reply, /登録しました（2件）/);
});

test('applyCommand: 完了→該当タスクが done に（部分一致）', () => {
  const store = emptyStore();
  applyCommand(store, { sender: '角南', messageId: 1, dateKey: TODAY, command: parseCommand('登録\n・提案資料作成', {}), todayKey: TODAY });
  const res = applyCommand(store, { sender: '角南', messageId: 2, dateKey: TODAY, command: parseCommand('完了\n・提案資料', {}), todayKey: TODAY });
  assert.equal(store.tasks[0].status, 'done');
  assert.match(res.reply, /完了にしました（1件）/);
});

test('applyCommand: 他人のタスクは完了にできない', () => {
  const store = emptyStore();
  applyCommand(store, { sender: '角南', messageId: 1, dateKey: TODAY, command: parseCommand('登録\n・提案資料作成', {}), todayKey: TODAY });
  const res = applyCommand(store, { sender: '別人', messageId: 2, dateKey: TODAY, command: parseCommand('完了\n・提案資料作成', {}), todayKey: TODAY });
  assert.equal(store.tasks[0].status, 'todo');
  assert.match(res.reply, /見つかりませんでした/);
});

test('applyCommand: 退勤→残タスクを集計して返信・スナップショット', () => {
  const store = emptyStore();
  applyCommand(store, { sender: '角南', messageId: 1, dateKey: TODAY, command: parseCommand('登録\n・A\n・B', {}), todayKey: TODAY });
  applyCommand(store, { sender: '角南', messageId: 2, dateKey: TODAY, command: parseCommand('完了\n・A', {}), todayKey: TODAY });
  const res = applyCommand(store, { sender: '角南', messageId: 3, dateKey: TODAY, command: parseCommand('退勤', {}), todayKey: TODAY });
  assert.match(res.reply, /残タスク 1件/);
  assert.match(res.reply, /・B/);
  assert.equal(store.snapshots.length, 1);
  assert.deepEqual(store.snapshots[0].remaining, ['B']);
});

test('applyCommand: 同じメッセージIDは二重処理しない', () => {
  const store = emptyStore();
  const cmd = parseCommand('登録\n・A', {});
  applyCommand(store, { sender: '角南', messageId: 7, dateKey: TODAY, command: cmd, todayKey: TODAY });
  const res2 = applyCommand(store, { sender: '角南', messageId: 7, dateKey: TODAY, command: cmd, todayKey: TODAY });
  assert.equal(res2.kind, 'skip');
  assert.equal(store.tasks.length, 1);
});

test('storeTasksToCalendar: カレンダー形式に変換、期限超過は遅延', () => {
  const store = emptyStore();
  applyCommand(store, { sender: '笹本', messageId: 1, dateKey: TODAY, command: parseCommand('登録\n・問い合わせ返信 8/1', { todayKey: TODAY }), todayKey: TODAY });
  const cal = storeTasksToCalendar(store, { todayKey: TODAY });
  assert.equal(cal[0].dept, 'cs');
  assert.equal(cal[0].status, 'late');
  assert.equal(cal[0].source, 'chatwork-report');
});
