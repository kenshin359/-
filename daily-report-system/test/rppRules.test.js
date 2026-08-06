// ============================================================
//  広告費レポートの「RPP運用メモ」のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・ルールが無ければ null（レポートは従来どおり）
//    ・強化/除外検討/ROAS下限が文面に入ること
//    ・done:true の項目は出さないこと
//    ・8月定例MTGの実ファイルが読めること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRppMemo, loadRppRules } from '../scripts/adReport.js';

test('ルールが無ければ null', () => {
  assert.equal(formatRppMemo(null), null);
  assert.equal(loadRppRules('2031-01-01'), null);
});

test('ROAS下限・強化・除外検討が文面に入る', () => {
  const rules = {
    policy: { roas_floor_pct: 1000 },
    reinforce: [{ code: 'suitcase01', 理由: 'CPC・KW強化' }],
    exclusion_candidates: [{ code: 'handyfan202601', roas_2026_07_pct: 123, 条件: '8月も費用対が上がらなければ一旦除外' }],
  };
  const memo = formatRppMemo(rules);
  assert.ok(memo.includes('ROAS目標: 1,000%以上'));
  assert.ok(memo.includes('強化: suitcase01'));
  assert.ok(memo.includes('除外検討: handyfan202601（7月ROAS 123%）'));
  assert.ok(memo.includes('8月も費用対が上がらなければ'));
});

test('done:true の項目は除外される', () => {
  const rules = {
    policy: { roas_floor_pct: 1000 },
    reinforce: [{ code: 'suitcase01', done: true }],
    exclusion_candidates: [{ code: 'rental03', roas_2026_07_pct: 194, done: true }],
  };
  const memo = formatRppMemo(rules);
  assert.ok(!memo.includes('suitcase01'));
  assert.ok(!memo.includes('rental03'));
  assert.ok(memo.includes('ROAS目標'));
});

test('2026年の実ファイルが読めてMTGの打ち手が入っている', () => {
  const rules = loadRppRules('2026-08-06');
  assert.ok(rules, 'config/rpp-rules-2026.json があること');
  const memo = formatRppMemo(rules);
  assert.ok(memo.includes('suitcase01'), '強化商品');
  assert.ok(memo.includes('handyfan202601'), '除外検討商品');
  assert.ok(memo.includes('rental03'), '除外検討商品');
});
