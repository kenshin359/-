// ============================================================
//  朝礼レポート（chorei）のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・「朝礼」の呼びかけを正しく見つけること
//    ・返信済みなら二重に返信しないこと
//    ・自分の返信を「朝礼の依頼」と誤認しないこと
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { isChoreiRequest, findPendingChorei, MARKER } from '../scripts/chorei.js';

test('「朝礼」の言い方ゆれを受け付ける', () => {
  assert.equal(isChoreiRequest('朝礼'), true);
  assert.equal(isChoreiRequest('【朝礼】'), true);
  assert.equal(isChoreiRequest(' 朝礼！ '), true);
  assert.equal(isChoreiRequest('朝礼お願いします'), true);
  assert.equal(isChoreiRequest('[To:123]北野さん\n朝礼'), true);
});

test('関係ない発言・自分の返信には反応しない', () => {
  assert.equal(isChoreiRequest('今日の朝礼は10時からです'), false);
  assert.equal(isChoreiRequest(''), false);
  assert.equal(isChoreiRequest(`${MARKER}（昨日 8/6 まで）…`), false);
});

test('未返信の朝礼があれば pending', () => {
  const msgs = [{ body: 'おはようございます' }, { body: '朝礼' }];
  assert.equal(findPendingChorei(msgs), true);
});

test('返信済みなら pending にならない', () => {
  const msgs = [{ body: '朝礼' }, { body: `${MARKER}（昨日 8/6 まで）\n売上…` }];
  assert.equal(findPendingChorei(msgs), false);
});

test('返信のあとの新しい朝礼はまた pending になる', () => {
  const msgs = [
    { body: '朝礼' },
    { body: `${MARKER} …` },
    { body: '朝礼' },
  ];
  assert.equal(findPendingChorei(msgs), true);
});
