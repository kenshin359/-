// ============================================================
//  新人スタッフ研修マニュアル（PDF）の設定JSONのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・12週ぶんが、決まった形（ゴール／数字／やること／できた？／
//      つまずいたら／むずかしい言葉）をすべて持つこと
//    ・むずかしい言葉に「かんたんな説明」と「たとえ」が必ず付くこと
//      （これが無いと、新人が読んで分からない本になる）
//    ・毎週の目標が「数字」で書かれていること（逆算の土台）
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'newbie-handbook.json'), 'utf8'));

test('表紙と使い方がそろっている', () => {
  for (const key of ['title', 'subtitle', 'lead', 'target', 'company', 'manager']) {
    assert.ok(cfg.meta[key] && cfg.meta[key].length > 0, `meta.${key} が空`);
  }
  assert.ok(cfg.howto.length >= 4, '使い方の説明が少ない');
  assert.equal(cfg.levels.length, 4, 'レベルはLv1〜Lv4の4段階');
  for (const row of cfg.levels) assert.equal(row.length, 4, `レベル表の列数: ${row[0]}`);
});

test('★逆算の説明が計算式つきで入っている', () => {
  assert.ok(cfg.backcalc.story.includes('逆算'), '逆算の説明が無い');
  assert.ok(cfg.backcalc.steps.length >= 4, '逆算の手順が少ない');
  for (const row of cfg.backcalc.steps) assert.equal(row.length, 3, `逆算の列数: ${row[0]}`);
  // 計算式（÷）と、あてはめた例が必ず入っている
  const all = cfg.backcalc.steps.map((r) => r.join(' ')).join('\n');
  assert.ok(all.includes('÷'), '割り算の式が無い（逆算の説明にならない）');
  assert.ok(cfg.backcalc.worksheet.length >= 5, 'ワークシートの行が少ない');
});

test('12週ぶんが、決まった形をすべて持つ', () => {
  assert.equal(cfg.weeks.length, 12);
  assert.deepEqual(cfg.weeks.map((w) => w.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const w of cfg.weeks) {
    assert.ok(w.days && w.level && w.oneline, `第${w.no}週の見出しが空`);
    assert.ok(/Lv[1-4]/.test(w.level), `第${w.no}週のレベル表記が変: ${w.level}`);
    assert.ok(w.goals.length >= 2, `第${w.no}週のゴールが少ない`);
    assert.ok(w.numbers.length >= 2, `第${w.no}週の数字が少ない`);
    for (const n of w.numbers) assert.equal(n.length, 3, `第${w.no}週の数字の列数`);
    assert.ok(w.todos.length >= 3, `第${w.no}週のやることが少ない`);
    assert.ok(w.checks.length >= 3, `第${w.no}週のチェックが少ない`);
    assert.ok(w.trouble.length >= 1, `第${w.no}週のつまずきが無い`);
    for (const t of w.trouble) assert.equal(t.length, 2, `第${w.no}週のつまずきの列数`);
  }
});

test('★毎週の目標が数字で書かれている', () => {
  for (const w of cfg.weeks) {
    for (const [item, value] of w.numbers) {
      assert.ok(/[0-9０-９]/.test(value), `第${w.no}週「${item}」の目標に数字が無い: ${value}`);
    }
  }
});

test('★むずかしい言葉に「かんたんな説明」と「たとえ」が付いている', () => {
  const rows = [...cfg.weeks.flatMap((w) => w.words), ...cfg.glossary];
  assert.ok(rows.length >= 30, '言葉の説明が少ない');
  for (const row of rows) {
    assert.equal(row.length, 3, `言葉の列数（言葉・説明・たとえ）: ${row[0]}`);
    assert.ok(row[1].length > 0, `かんたんな説明が空: ${row[0]}`);
    assert.ok(row[2].length > 0, `たとえが空: ${row[0]}`);
  }
});

test('レベルが上がる条件が数字で決まっている', () => {
  assert.equal(cfg.level_up.length, 3);
  for (const [level, cond] of cfg.level_up) {
    assert.ok(/[0-9０-９]/.test(cond), `${level} の条件に数字が無い`);
  }
});
