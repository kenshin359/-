// ============================================================
//  返信文テンプレートエンジンのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・低評価には明るい結びを使わないこと
//    ・「また購入したい（意向）」をリピート済みと言わないこと
//    ・低評価は必ず要確認になること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFromTemplates, detectThemes, assembleNegativeReply } from '../lib/replyTemplates.js';
import { loadBlocks, assembleReply, auditReply } from '../lib/replyDraft.js';

const cfg = loadBlocks();

test('★5・褒めレビューは話題に合った一文が入り、要確認にならない', () => {
  const review = { star: 5, date: '2026/08/01', who: 'テストさん', body: '風も強くて涼しい。夏に重宝します！' };
  const ai = draftFromTemplates(review);
  assert.equal(ai.needs_human, false);
  assert.match(ai.body, /風量|風/);
  const built = assembleReply(ai, review, cfg);
  assert.ok(built.text.includes('弊社楽天ショップ'));
  assert.deepEqual(auditReply(built.text), []);
});

test('「また購入したい」は意向として返す（前回のお礼と言わない）', () => {
  const review = { star: 5, date: '2026/08/01', who: 'a', body: '丁寧な梱包。また購入したいと思います。' };
  const ai = draftFromTemplates(review);
  assert.ok(!ai.body.includes('前回'), '「前回に続き」と言ってはいけない');
  assert.match(ai.body, /また(の|購入)/);
});

test('★1は要確認になり、明るい結びを使わない文面になる', () => {
  const review = { star: 1, date: '2026/08/02', who: 'b', body: '届いて1週間で壊れました。交換してほしい。' };
  const ai = draftFromTemplates(review);
  assert.equal(ai.needs_human, true);
  assert.ok(ai.apology.length > 0);
  const text = assembleNegativeReply(ai, cfg);
  assert.ok(!text.includes('たくさんご使用いただけますと幸いです'), '低評価に明るい結びは不適切');
  assert.ok(text.includes('申し訳ございません'));
  assert.ok(text.includes('問い合わせ窓口'));
  assert.deepEqual(auditReply(text), [], '返金・無償交換などの約束をしていないこと');
});

test('話題検出は最大2件・優先度順', () => {
  const t = detectThemes('リピートです。配送も早く、梱包も丁寧でした。');
  assert.equal(t.length, 2);
  assert.equal(t[0], 'リピート');
});
