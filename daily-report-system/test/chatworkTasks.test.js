// Chatworkタスク → カレンダー用タスク の変換テスト（ネットワーク不要）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatworkTaskToTask, chatworkTasksToTasks } from '../lib/chatworkTasks.js';
import { buildDataset } from '../lib/taskData.js';

// 2026-08-05 00:00 と 08-01 の unix秒（ローカル基準に依存しないよう Date から作る）
const unix = (y, m, d) => Math.floor(new Date(y, m - 1, d).getTime() / 1000);

test('chatworkTaskToTask: 担当者名からチームを割り当て、期限・状態を変換', () => {
  const t = chatworkTaskToTask(
    { task_id: 12, body: 'LP改修レビュー', status: 'open', limit_time: unix(2026, 8, 10), account: { name: '黒葛原 花子' } },
    { todayKey: '2026-08-05' }
  );
  assert.equal(t.title, 'LP改修レビュー');
  assert.equal(t.dept, 'ad'); // 黒葛原 の主所属
  assert.equal(t.memberName, '黒葛原 花子');
  assert.equal(t.status, 'todo');
  assert.equal(t.key, '2026-08-10');
  assert.equal(t.id, 'cw12');
});

test('chatworkTaskToTask: 期限超過の未完了は遅延に', () => {
  const t = chatworkTaskToTask(
    { task_id: 1, body: '問い合わせ返信', status: 'open', limit_time: unix(2026, 8, 1), account: { name: '笹本' } },
    { todayKey: '2026-08-05' }
  );
  assert.equal(t.status, 'late');
  assert.equal(t.dept, 'cs');
});

test('chatworkTaskToTask: done は完了', () => {
  const t = chatworkTaskToTask(
    { task_id: 2, body: 'バナー入稿', status: 'done', limit_time: unix(2026, 8, 4), account: { name: '内田' } },
    { todayKey: '2026-08-05' }
  );
  assert.equal(t.status, 'done');
  assert.equal(t.dept, 'sns');
});

test('chatworkTaskToTask: 期限なしは当日扱い、緊急語は優先度高、本文1行目がタイトル', () => {
  const t = chatworkTaskToTask(
    { task_id: 3, body: '至急 見積もり作成\n詳細は別途', status: 'open', limit_time: 0, account: { name: '角南' } },
    { todayKey: '2026-08-05' }
  );
  assert.equal(t.key, '2026-08-05');
  assert.equal(t.prio, '高');
  assert.equal(t.title, '至急 見積もり作成');
});

test('chatworkTaskToTask: 本文から種別を推定する', () => {
  const cat = (body) =>
    chatworkTaskToTask({ task_id: 1, body, status: 'open', account: { name: '角南' } }, { todayKey: '2026-08-05' }).cat;
  assert.equal(cat('週次定例MTG'), 'meeting');
  assert.equal(cat('問い合わせ返信'), 'cs');
  assert.equal(cat('広告レポート集計'), 'analyze');
  assert.equal(cat('LP改修の実装'), 'dev');
  assert.equal(cat('原稿の校正'), 'review');
  assert.equal(cat('出荷手配'), 'ship');
  assert.equal(cat('その他メモ'), 'doc');
});

test('chatworkTaskToTask: 本文が空なら null', () => {
  assert.equal(chatworkTaskToTask({ task_id: 9, body: '   ', account: { name: 'x' } }, {}), null);
});

test('chatworkTaskToTask: 名簿に無い名前は本部チームに寄せる', () => {
  const t = chatworkTaskToTask({ task_id: 4, body: 'x', status: 'open', account: { name: '未知 太郎' } }, { todayKey: '2026-08-05' });
  assert.equal(t.dept, 'honbu');
});

test('chatworkTasksToTasks + buildDataset: 各スタッフのタスクがまとまる', () => {
  const cw = [
    { task_id: 1, body: 'A', status: 'open', limit_time: unix(2026, 8, 6), account: { name: '角南' } },
    { task_id: 2, body: 'B', status: 'open', limit_time: unix(2026, 8, 7), account: { name: '黒葛原' } },
    { task_id: 2, body: 'B(重複)', status: 'open', account: { name: '黒葛原' } }, // 同一task_idは除外
  ];
  const tasks = chatworkTasksToTasks(cw, { todayKey: '2026-08-05' });
  assert.equal(tasks.length, 2);
  const ds = buildDataset(tasks, '2026-08-05T00:00:00Z');
  assert.equal(ds.members.length, 2);
  assert.ok(ds.members.some((m) => m.name === '角南'));
});
