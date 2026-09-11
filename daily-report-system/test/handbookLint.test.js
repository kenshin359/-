// ============================================================
//  研修資料の品質チェック（仕上げ基準）のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・判定ルールが、正しい文を誤って指摘しないこと（誤検知が多いと使われなくなる）
//    ・悪い例（測れない合格基準・あいまい語・誇大表現）は必ず捕まえること
//    ・いま配っている3冊が、重大な指摘ゼロを保つこと（これが配布の合否ライン）
//    ・AIの書き直しを採用する前の「形が変わっていないか」の確認が効くこと
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  endsWithVerb, vagueWords, bannedWords, longSentences, lintHandbook, summarize,
} from '../scripts/handbookLint.js';
import { parseJson, sameShape, buildUserText } from '../scripts/handbookAI.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('動詞で終わる指示を、正しいと判定する', () => {
  for (const ok of [
    '来店されたら、作業を止めて3分以内に声をかける。',
    '実施内容を記録し、次回につなぐ。',
    '開店準備を3回やる（チェック表を見ながらでよい）。',
    '痛みが出たら重量を落とす',
    '週40時間を超えない',
    '飲酒後の利用は禁止',
  ]) assert.equal(endsWithVerb(ok), true, `動詞と判定されるべき: ${ok}`);
});

test('名詞で終わる指示は、指摘する', () => {
  for (const ng of ['予約の確認', '売上の集計について', '安全管理']) {
    assert.equal(endsWithVerb(ng), false, `指摘されるべき: ${ng}`);
  }
});

test('あいまいな言葉を見つける', () => {
  assert.deepEqual(vagueWords('なるべく早く報告する'), ['なるべく']);
  assert.deepEqual(vagueWords('しっかり確認する'), ['しっかり']);
  assert.deepEqual(vagueWords('30分以内に報告する'), []);
});

test('誇大表現は指摘し、かぎかっこの「悪い例」は指摘しない', () => {
  assert.ok(bannedWords('絶対に痩せます').includes('絶対に'));
  // 教える側が「使ってはいけない例」として示す文は、指摘しない
  assert.deepEqual(bannedWords('「絶対に痩せる」などの断定表現は使わない'), []);
});

test('長すぎる文を見つける', () => {
  const long = `${'あ'.repeat(70)}。`;
  assert.equal(longSentences(long).length, 1);
  assert.equal(longSentences('短い文です。').length, 0);
});

test('測れない合格基準を、重大な指摘として捕まえる', () => {
  const bad = {
    meta: { title: 'テスト', subtitle: 'x', lead: 'x', target: 'x', revision: { version: '1.0' } },
    chapters: [{
      no: '①', title: 'テスト章', lead: 'x',
      goal: '理解する',
      words: [['用語', '説明', 'たとえ']],
      steps: ['確認する'],
      fixed: ['守る'],
      guides: ['目安'],
      checks: ['できる'],
      solo: ['内容を理解する', '意識する', '把握する'],
    }],
  };
  const issues = lintHandbook(bad);
  const solo = issues.filter((i) => i.rule === 'solo');
  assert.equal(solo.length, 3, '測れない合格基準3つが捕まること');
  assert.ok(solo.every((i) => i.level === 'error'));
});

test('構成が欠けている章を、重大な指摘として捕まえる', () => {
  const bad = {
    meta: { title: 'a', subtitle: 'b', lead: 'c', target: 'd' },
    chapters: [{ no: '①', title: 'x', lead: 'y', goal: '合図＝できる', words: [], steps: [] }],
  };
  const rules = lintHandbook(bad).filter((i) => i.rule === 'structure').map((i) => i.message);
  assert.ok(rules.some((m) => m.includes('fixed')), '必ず守ることの欠落を検知する');
  assert.ok(rules.some((m) => m.includes('solo')), '合格の判定の欠落を検知する');
});

test('★配っている3冊は、重大な指摘ゼロを保つ', () => {
  const files = readdirSync(join(ROOT, 'config')).filter((f) => f.endsWith('-handbook.json'));
  assert.equal(files.length, 3);
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'config', f), 'utf8'));
    const { errors, score } = summarize(lintHandbook(cfg, f));
    assert.equal(errors, 0, `${f} に重大な指摘があります`);
    assert.ok(score >= 95, `${f} の点数が低すぎます: ${score}点`);
  }
});

test('AIの応答からJSONを取り出せる（説明やコードフェンスが付いていても）', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('はい、直しました:\n{"a":1}\nご確認ください'), { a: 1 });
  assert.throws(() => parseJson('JSONではありません'));
});

test('★AIが形を変えて返したら、採用しないと判定する', () => {
  const before = { no: '①', steps: ['a', 'b'], words: [['x', 'y', 'z']] };
  assert.equal(sameShape(before, { no: '①', steps: ['A', 'B'], words: [['X', 'Y', 'Z']] }), null);
  assert.match(sameShape(before, { no: '①', steps: ['A'], words: [['X', 'Y', 'Z']] }), /件数/);
  assert.match(sameShape(before, { no: '①', steps: ['A', 'B'] }), /キー/);
  assert.match(sameShape(before, { no: '①', steps: ['A', 'B'], words: [['X', 'Y']] }), /列数/);
});

test('AIへ渡す文章に、機械チェックの指摘が入る', () => {
  const text = buildUserText({ no: '①' }, '第①章', [{ rule: 'solo', message: '測れません' }]);
  assert.ok(text.includes('機械チェックで見つかった直すべき点'));
  assert.ok(text.includes('測れません'));
  assert.ok(text.includes('JSONのキーと配列の要素数は変えない'));
});
