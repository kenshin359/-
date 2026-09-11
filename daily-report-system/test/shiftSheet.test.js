// ============================================================
//  シフト表（Excel）の設定JSONのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・記号の表がずれると労働時間の計算が丸ごと狂うので、形を固定する
//    ・「出勤扱い」と実働時間の関係が矛盾しないこと（休なのに時間がある等）
//    ・開店／閉店をカバーする記号が、実在する記号であること
//    ・労務の注意書き（週40時間・休憩・週1日の休日）が消えないこと
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'shift.json'), 'utf8'));
const symbols = cfg.symbols.map((r) => r[0]);

test('記号は[記号,名称,開始,終了,休憩,実働時間,出勤扱い]の7要素', () => {
  assert.ok(cfg.symbols.length >= 4);
  for (const row of cfg.symbols) {
    assert.equal(row.length, 7, `列数がずれている: ${row[0]}`);
    assert.equal(typeof row[4], 'number', `休憩が数値でない: ${row[0]}`);
    assert.equal(typeof row[5], 'number', `実働時間が数値でない: ${row[0]}`);
    assert.equal(typeof row[6], 'boolean', `出勤扱いが true/false でない: ${row[0]}`);
    assert.ok(row[0].length <= 2, `記号が長すぎる（1〜2文字）: ${row[0]}`);
  }
  assert.equal(new Set(symbols).size, symbols.length, '記号が重複している');
});

test('出勤扱いと実働時間が矛盾しない', () => {
  for (const [sym, , , , , hours, work] of cfg.symbols) {
    if (work) assert.ok(hours > 0, `出勤扱いなのに実働時間が0: ${sym}`);
    else assert.equal(hours, 0, `休みなのに実働時間が入っている: ${sym}`);
  }
  assert.ok(cfg.symbols.some((r) => r[6]), '出勤扱いの記号が1つもない');
  assert.ok(cfg.symbols.some((r) => !r[6]), '休みの記号が1つもない');
});

test('開店・閉店をカバーする記号は実在する記号', () => {
  for (const key of ['open_symbols', 'close_symbols']) {
    assert.ok(cfg[key].length > 0, `${key} が空`);
    for (const sym of cfg[key]) {
      assert.ok(symbols.includes(sym), `${key} の「${sym}」が記号表にない`);
      const row = cfg.symbols.find((r) => r[0] === sym);
      assert.ok(row[6], `${key} の「${sym}」が出勤扱いでない`);
    }
  }
});

test('必要人数は曜日7つぶん数値で入っている', () => {
  for (const wd of ['月', '火', '水', '木', '金', '土', '日']) {
    assert.equal(typeof cfg.required[wd], 'number', `必要人数に${wd}がない`);
    assert.ok(cfg.required[wd] >= 1, `${wd}の必要人数が1未満`);
  }
});

test('スタッフ行と希望シフトの記号がそろっている', () => {
  for (const row of cfg.staff) assert.equal(row.length, 4, `スタッフ行の列数: ${row[0]}`);
  assert.equal(cfg.wish_marks.length, 3);
  assert.ok(cfg.wish_deadline.length > 0, '希望の提出期限が空');
});

test('★労務の注意書きが残っている', () => {
  const all = cfg.labor_notes.join('\n');
  assert.ok(cfg.labor_notes.length >= 5);
  assert.ok(all.includes('40時間'), '週40時間の注意が消えている');
  assert.ok(all.includes('休憩'), '休憩の注意が消えている');
  assert.ok(/週1日|4週で4日/.test(all), '休日の注意が消えている');
  assert.equal(typeof cfg.cost.target_rate, 'number');
});
