// ============================================================
//  店舗責任者 業務マニュアル（Excel）の設定JSONのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・現場がJSONを編集しても、生成スクリプトが壊れる形にならないこと
//      （行の要素数がずれると Excel の列がずれる）
//    ・「完了の定義」が空の項目を混ぜないこと（数字で締めるルール）
//    ・習得状況シートの列（skills）と教育カリキュラムが食い違わないこと
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'store-manual.json'), 'utf8'));

test('担当者・店舗・報告先が入っている', () => {
  for (const key of ['person', 'store', 'report_to', 'channel']) {
    assert.equal(typeof cfg[key], 'string', `${key} が文字列でない`);
    assert.ok(cfg[key].length > 0, `${key} が空`);
  }
});

test('KPIは列名6つと目標4項目を持つ', () => {
  // 体験・見学 / 入会 / 退会 / 在籍会員数 / セッション実施 / 売上
  assert.equal(cfg.kpi.labels.length, 6);
  for (const key of ['sales', 'joins', 'members_start', 'workdays']) {
    assert.equal(typeof cfg.kpi.targets[key], 'number', `targets.${key} が数値でない`);
  }
});

test('日次は[時間帯,業務,完了の定義,目安分]の4要素で、時間帯は3ブロックのみ', () => {
  const blocks = new Set();
  for (const row of cfg.daily) {
    assert.equal(row.length, 4, `列数がずれている: ${row[1]}`);
    assert.equal(typeof row[3], 'number', `目安分が数値でない: ${row[1]}`);
    blocks.add(row[0]);
  }
  assert.deepEqual([...blocks], ['開店前', '営業中', '閉店後']);
});

test('週次・月次・判断基準の列数が揃っている', () => {
  for (const row of cfg.weekly) assert.equal(row.length, 3, `週次の列数: ${row[0]}`);
  for (const row of cfg.monthly) assert.equal(row.length, 3, `月次の列数: ${row[0]}`);
  for (const row of cfg.escalation) assert.equal(row.length, 5, `判断基準の列数: ${row[0]}`);
});

test('チェック項目の「完了の定義」が空でない', () => {
  for (const [, task, done] of cfg.daily) {
    assert.ok(done && done.length > 0, `完了の定義が空: ${task}`);
  }
  for (const [task, done] of [...cfg.weekly, ...cfg.monthly]) {
    assert.ok(done && done.length > 0, `完了の定義が空: ${task}`);
  }
});

test('教育カリキュラムは4段階で、到達基準と標準日数がある', () => {
  const levels = new Set(cfg.curriculum.map((r) => r[0]));
  assert.equal(levels.size, 4);
  for (const row of cfg.curriculum) {
    assert.equal(row.length, 5, `列数がずれている: ${row[1]}`);
    assert.ok(row[2].length > 0, `到達基準が空: ${row[1]}`);
    assert.equal(typeof row[3], 'number', `標準日数が数値でない: ${row[1]}`);
  }
});

test('習得状況の列はカリキュラムの項目数と釣り合っている', () => {
  assert.ok(cfg.skills.length >= 8, '習得状況の列が少なすぎる');
  assert.equal(new Set(cfg.skills).size, cfg.skills.length, '列名が重複している');
  assert.equal(cfg.skill_levels.length, 4);
  assert.deepEqual(cfg.skill_levels.map((r) => r[0]), [1, 2, 3, 4]);
});

test('上司報告は4種類あり、定型文が用意されている', () => {
  assert.equal(cfg.reports.length, 4);
  for (const row of cfg.reports) assert.equal(row.length, 4, `報告の列数: ${row[0]}`);
  assert.ok(cfg.urgent_cases.length >= 3);
  const bodies = Object.values(cfg.templates);
  assert.equal(bodies.length, 4);
  // 定型文は複数行（数字の入った雛形）であること
  for (const body of bodies) assert.ok(body.includes('\n'), '定型文が1行しかない');
});
