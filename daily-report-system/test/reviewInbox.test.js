// ============================================================
//  返信待ちレビュー取り出しのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・「過去N日かつ未返信」だけが残ること
//    ・ルーム名の照合（完全一致優先・部分一致は1件のときだけ）
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPending, parseJpDate } from '../scripts/reviewInbox.js';
import { findRoom, normalizeRoomName, candidateRooms } from '../scripts/sendReviewInbox.js';

test('過去7日かつ未返信のレビューだけが残る', () => {
  const rows = [
    { date: '2026/08/03', shopReply: false },  // 今日・未返信 → 残る
    { date: '2026/08/01', shopReply: true },   // 返信済み → 落ちる
    { date: '2026/07/28', shopReply: false },  // 7日前(6日差) → 残る
    { date: '2026/07/27', shopReply: false },  // 8日前(7日差) → 落ちる
    { date: '2026/8/2', shopReply: false },    // ゼロ埋めなしでも読める
  ];
  const out = filterPending(rows, '2026-08-03', 7);
  assert.deepEqual(out.map((r) => r.date), ['2026/08/03', '2026/07/28', '2026/8/2']);
});

test('日付の読み取り（ゼロ埋みあり・なし両対応）', () => {
  assert.equal(parseJpDate('2026/08/03').toISOString().slice(0, 10), '2026-08-03');
  assert.equal(parseJpDate('2026/8/3').toISOString().slice(0, 10), '2026-08-03');
});

test('ルーム名は完全一致を最優先、部分一致は1件のときだけ', () => {
  const rooms = [
    { room_id: 1, name: 'CSレビューチーム' },
    { room_id: 2, name: 'CSレビューチーム（旧）' },
    { room_id: 3, name: '経営会議' },
  ];
  assert.equal(findRoom(rooms, 'CSレビューチーム').room_id, 1);
  assert.equal(findRoom(rooms, '経営'), rooms[2]);
  assert.equal(findRoom(rooms, 'CS'), null, '部分一致が複数なら選ばない（誤送信防止）');
  assert.equal(findRoom(rooms, '存在しない'), null);
});

test('表記ゆれ（全角・スペース・かざり）を吸収して見つける', () => {
  assert.equal(normalizeRoomName('【ＣＳ レビュー チーム】'), 'csレビューチーム');
  const rooms = [
    { room_id: 1, name: '【CS】レビューチーム☆' },
    { room_id: 2, name: '経営会議' },
  ];
  assert.equal(findRoom(rooms, 'CSレビューチーム').room_id, 1);
  const cands = candidateRooms(rooms, 'CSレビューチーム');
  assert.deepEqual(cands.map((r) => r.room_id), [1]);
});
