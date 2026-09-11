// ============================================================
//  トレーナー研修ハンドブック（PDF）の設定JSONのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・全8章が、決まった7つのパート（ゴール〜独り立ち判定）を必ず持つこと
//      （1つでも欠けると、章によって研修の進め方が変わってしまう）
//    ・安全にかかわる章の固定ルールが消えないこと
//    ・まとめテストの問題に必ず解答が付いていること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'gym-handbook.json'), 'utf8'));

test('表紙に必要な項目がそろっている', () => {
  for (const key of ['title', 'subtitle', 'lead', 'target', 'company', 'manager']) {
    assert.ok(cfg.meta[key] && cfg.meta[key].length > 0, `meta.${key} が空`);
  }
  assert.equal(cfg.legend.length, 2, '「固定」と「目安」の2区分が必要');
  assert.ok(cfg.legend_note.includes('目安'));
});

test('全8章が7つのパートをすべて持つ', () => {
  assert.equal(cfg.chapters.length, 8);
  const nos = cfg.chapters.map((c) => c.no);
  assert.deepEqual(nos, ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']);
  for (const c of cfg.chapters) {
    assert.ok(c.title && c.lead && c.goal, `${c.no} の見出し・ゴールが空`);
    assert.ok(c.goal.includes('合図'), `${c.no} のゴールに「合図＝」が無い`);
    assert.ok(c.terms.length >= 3, `${c.no} の用語が少ない`);
    for (const t of c.terms) assert.equal(t.length, 2, `${c.no} の用語表の列数`);
    assert.ok(c.steps.length >= 3, `${c.no} の手順が少ない`);
    assert.ok(c.fixed.length >= 2, `${c.no} の固定ルールが少ない`);
    assert.ok(c.guides.length >= 1, `${c.no} の運用の目安が無い`);
    assert.ok(c.checks.length >= 5, `${c.no} のチェックリストが少ない`);
    assert.equal(c.solo.length, 3, `${c.no} の独り立ち判定は3つ`);
  }
});

test('★安全の章の固定ルールが残っている', () => {
  const safety = cfg.chapters.find((c) => c.no === '②');
  assert.ok(safety.title.includes('安全'), '②章が安全管理でなくなっている');
  const all = safety.fixed.join('\n');
  assert.ok(all.includes('当日報告') || all.includes('30分'), '当日報告のルールが消えている');
  assert.ok(all.includes('救急'), '救急要請のルールが消えている');
  assert.ok(/診断|治療/.test(all), '医療行為をしない旨のルールが消えている');
});

test('★契約・法律にかかわる記載が残っている', () => {
  const trial = cfg.chapters.find((c) => c.no === '⑥');
  const all = trial.fixed.join('\n');
  assert.ok(all.includes('特定商取引法'), '特定継続的役務提供の注意が消えている');
  assert.ok(all.includes('クーリング・オフ'), 'クーリング・オフの説明が消えている');
});

test('研修スケジュールと1日の流れの形がそろっている', () => {
  assert.ok(cfg.schedule.length >= 5);
  for (const row of cfg.schedule) assert.equal(row.length, 3, `スケジュールの列数: ${row[0]}`);
  for (const row of cfg.flow) assert.equal(row.length, 3, `1日の流れの列数: ${row[0]}`);
  for (const row of cfg.emergency) assert.equal(row.length, 3, `緊急時の列数: ${row[0]}`);
});

test('言い方の型は［NG, OK］の2列', () => {
  assert.ok(cfg.phrases.length >= 4);
  for (const row of cfg.phrases) assert.equal(row.length, 2, `言い方の型の列数: ${row[0]}`);
});

test('まとめテストは全問に解答が付いている', () => {
  assert.ok(cfg.test.length >= 15, `問題数が少ない: ${cfg.test.length}`);
  for (const [q, a] of cfg.test) {
    assert.ok(q && q.length > 0, '問題が空');
    assert.ok(a && a.length > 0, `解答が空: ${q}`);
  }
});
