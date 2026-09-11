// ============================================================
//  管理職育成マニュアル（PDF）の設定JSONのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・全8章が、決まった7つのパート＋ひとこと＋つまずき＋宿題を持つこと
//    ・むずかしい言葉に「かんたんに言うと」と「たとえると」が必ず付くこと
//    ・労務・安全・お金の「必ず守ること」が消えないこと
//    ・6か月の育成計画が、月ごとに数字の到達基準を持つこと
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'manager-handbook.json'), 'utf8'));
const ch = (no) => cfg.chapters.find((c) => c.no === no);

test('全8章が決まった形をすべて持つ', () => {
  assert.equal(cfg.chapters.length, 8);
  assert.deepEqual(cfg.chapters.map((c) => c.no), ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']);
  for (const c of cfg.chapters) {
    assert.ok(c.title && c.lead && c.oneline, `${c.no} の見出し・ひとことが空`);
    assert.ok(c.goal.includes('合格'), `${c.no} のゴールに合格ラインが無い`);
    assert.ok(c.words.length >= 3, `${c.no} の言葉が少ない`);
    assert.ok(c.steps.length >= 3, `${c.no} の手順が少ない`);
    assert.ok(c.fixed.length >= 2, `${c.no} の必ず守ることが少ない`);
    assert.ok(c.guides.length >= 1, `${c.no} の目安が無い`);
    assert.ok(c.checks.length >= 4, `${c.no} のチェックが少ない`);
    assert.equal(c.solo.length, 3, `${c.no} の合格判定は3つ`);
    assert.ok(c.trouble.length >= 1, `${c.no} のつまずきが無い`);
    assert.ok(c.homework.length >= 1, `${c.no} の宿題が無い`);
  }
});

test('★むずかしい言葉に「かんたんに言うと」と「たとえると」が付いている', () => {
  for (const c of cfg.chapters) {
    for (const row of c.words) {
      assert.equal(row.length, 3, `${c.no} の言葉の列数: ${row[0]}`);
      assert.ok(row[1].length > 0, `${c.no} かんたんな説明が空: ${row[0]}`);
      assert.ok(row[2].length > 0, `${c.no} たとえが空: ${row[0]}`);
    }
  }
  for (const row of cfg.numbers) {
    assert.equal(row.length, 3, `早見表の列数: ${row[0]}`);
    assert.ok(row[1].length > 0, `早見表の説明が空: ${row[0]}`);
  }
});

test('★逆算の章に、順番と4つの打ち手が書かれている', () => {
  const c = ch('②');
  const all = [...c.steps, ...c.guides, ...c.trouble.flat()].join('\n');
  assert.ok(all.includes('÷'), '逆算の計算式が消えている');
  assert.ok(/入会率/.test(all), '入会率が出てこない');
  const test4 = cfg.test.find(([q]) => q.includes('打ち手4つ'));
  assert.ok(test4, '打ち手4つを問う設問が消えている');
});

test('★労務・安全・お金の「必ず守ること」が残っている', () => {
  const labor = ch('④').fixed.join('\n');
  assert.ok(labor.includes('40時間'), '週40時間の決まりが消えている');
  assert.ok(labor.includes('休憩'), '休憩の決まりが消えている');
  assert.ok(labor.includes('18歳'), '未成年の深夜勤務の決まりが消えている');

  const money = ch('⑤').fixed.join('\n');
  assert.ok(/差異/.test(money), '金銭差異の当日報告が消えている');
  assert.ok(/返金|値引/.test(money), '値引き・返金を自分で決めない決まりが消えている');

  const safety = ch('⑥');
  assert.ok(safety.oneline.includes('止める'), '「止める・呼ぶ・残す」が消えている');
  assert.ok(safety.fixed.join('\n').includes('当日報告'), '当日報告の決まりが消えている');
});

test('1か月カレンダーと1on1の型がそろっている', () => {
  assert.ok(cfg.calendar.length >= 8);
  for (const row of cfg.calendar) assert.equal(row.length, 3, `カレンダーの列数: ${row[0]}`);
  assert.equal(cfg.one_on_one.length, 4, '1on1は15分を4つに分ける');
  for (const row of cfg.one_on_one) assert.equal(row.length, 3, `1on1の列数: ${row[0]}`);
  for (const row of cfg.phrases) assert.equal(row.length, 2, `言い方の型の列数: ${row[0]}`);
});

test('★6か月の育成計画が、月ごとに数字の到達基準を持つ', () => {
  assert.equal(cfg.succession.length, 6, '6か月ぶん必要');
  for (const [month, task, standard] of cfg.succession) {
    assert.ok(task.length > 0, `${month} の渡す仕事が空`);
    assert.ok(/[0-9０-９]/.test(standard), `${month} の到達基準に数字が無い: ${standard}`);
  }
});

test('理解度テストは全問に解答が付いている', () => {
  assert.ok(cfg.test.length >= 12, `問題数が少ない: ${cfg.test.length}`);
  for (const [q, a] of cfg.test) {
    assert.ok(q.length > 0 && a.length > 0, `解答が空: ${q}`);
  }
});
