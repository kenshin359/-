// 議事録 → タスク抽出のテスト（ネットワーク・AI不要の純関数部分）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDue,
  parseExtraction,
  extractionToTasks,
  buildExtractPrompt,
  ruleExtractTasks,
} from '../lib/taskExtract.js';

test('normalizeDue: 各種表記を YYYY-MM-DD に', () => {
  assert.equal(normalizeDue('2026-08-15', '2026-08-05'), '2026-08-15');
  assert.equal(normalizeDue('2026/8/9', '2026-08-05'), '2026-08-09');
  assert.equal(normalizeDue('8/20', '2026-08-05'), '2026-08-20');
  assert.equal(normalizeDue('8月3日', '2026-08-05'), '2026-08-03');
  assert.equal(normalizeDue('未定', '2026-08-05'), null);
  assert.equal(normalizeDue('', '2026-08-05'), null);
});

test('normalizeDue: 大きく過去の M/D は翌年扱い', () => {
  assert.equal(normalizeDue('1/5', '2026-12-20'), '2027-01-05');
});

test('parseExtraction: コードフェンス/前後文があってもJSON配列を取り出す', () => {
  const raw = 'こちらです\n```json\n[{"assignee":"角南","title":"広告レポート","due":"2026-08-10"}]\n```\nよろしく';
  const items = parseExtraction(raw);
  assert.equal(items.length, 1);
  assert.equal(items[0].assignee, '角南');
});

test('parseExtraction: 壊れていれば空配列', () => {
  assert.deepEqual(parseExtraction('抽出できませんでした'), []);
  assert.deepEqual(parseExtraction(''), []);
});

test('extractionToTasks: チーム割当・種別推定・遅延判定・期限なしは当日', () => {
  const tasks = extractionToTasks(
    [
      { assignee: '黒葛原', title: 'LP改修の実装', due: '2026-08-10', priority: '高' },
      { assignee: '笹本', title: '問い合わせ返信', due: '2026-08-01' }, // 期限超過→遅延
      { assignee: '角南', title: '広告レポート', due: null }, // 期限なし→当日
    ],
    { todayKey: '2026-08-05' }
  );
  assert.equal(tasks.length, 3);
  const lp = tasks.find((t) => t.title === 'LP改修の実装');
  assert.equal(lp.dept, 'ad');
  assert.equal(lp.cat, 'dev');
  assert.equal(lp.prio, '高');
  assert.equal(tasks.find((t) => t.title === '問い合わせ返信').status, 'late');
  assert.equal(tasks.find((t) => t.title === '広告レポート').key, '2026-08-05');
  assert.ok(tasks.every((t) => t.source === 'chatwork-minutes'));
});

test('extractionToTasks: タイトル空は除外、同一内容は重複排除', () => {
  const tasks = extractionToTasks(
    [
      { assignee: '角南', title: '', due: null },
      { assignee: '角南', title: '同じ', due: '2026-08-10' },
      { assignee: '角南', title: '同じ', due: '2026-08-10' },
    ],
    { todayKey: '2026-08-05' }
  );
  assert.equal(tasks.length, 1);
});

test('buildExtractPrompt: 基準日と議事録本文を含み、JSON配列で返すよう指示', () => {
  const { system, userText } = buildExtractPrompt('朝礼メモ 角南：広告レポート', { todayKey: '2026-08-05' });
  assert.match(system, /JSON 配列/);
  assert.match(userText, /基準日: 2026-08-05/);
  assert.match(userText, /広告レポート/);
});

test('ruleExtractTasks: 「担当：内容（期限）」形式を抽出', () => {
  const text = [
    '【朝礼 2026/8/5】',
    '・角南：広告レポート提出（8/10まで）',
    '- 笹本：問い合わせ返信 至急',
    '共有：来月の全体会議について', // 担当タスクでない→拾ってもタイトルは残るが担当は「共有」になる
    '三浦：LP改修 8月12日',
  ].join('\n');
  const tasks = ruleExtractTasks(text, { todayKey: '2026-08-05' });
  const kado = tasks.find((t) => t.memberName === '角南');
  assert.ok(kado);
  assert.equal(kado.key, '2026-08-10');
  assert.match(kado.title, /広告レポート/);
  const sasa = tasks.find((t) => t.memberName === '笹本');
  assert.equal(sasa.prio, '高');
  const miura = tasks.find((t) => t.memberName === '三浦');
  assert.equal(miura.key, '2026-08-12');
  assert.equal(miura.dept, 'lp');
});
