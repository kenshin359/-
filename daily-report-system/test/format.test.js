// ============================================================
//  ユニットテスト（ネットワーク不要）
// ------------------------------------------------------------
//  実行:  node --test test/
//  lib の純粋関数（整形・分割・JSONパース・正規化）を検証します。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatCeoReport, formatLineReport, formatUrgentLine, toAiReportRecord } from '../lib/format.js';
import { splitForLine } from '../lib/line.js';
import { parseJsonFromModel } from '../lib/claude.js';
import { normalizeReport, buildAnalysisInput } from '../lib/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/sample-claude-output.json'), 'utf8'));

test('formatCeoReport は必須の見出しを全て含む', () => {
  const t = formatCeoReport(analysis, '2026-07-28');
  for (const h of ['【本日の結論】', '【本日の成果】', '【問題】', '【承認依頼】', '【進捗遅延】', '【明日の最優先】', '【スタッフ別要約】', '【AI分析】']) {
    assert.ok(t.includes(h), `見出しが無い: ${h}`);
  }
  assert.ok(t.includes('🔴'), '結論ステータスが反映されていない');
});

test('formatLineReport は LINE 用の見出しを含む', () => {
  const t = formatLineReport(analysis, '2026-07-28');
  for (const h of ['📊 Libetee 日報', '【結論】', '【成果】', '【要対応】', '【承認】', '【明日の最優先】', '詳細はKintone']) {
    assert.ok(t.includes(h), `見出しが無い: ${h}`);
  }
});

test('情報不足の扱い: 空配列は「情報不足」になる', () => {
  const t = formatLineReport({ conclusion: { status: '🟢', headline: 'ok' } }, '2026-07-28');
  assert.ok(t.includes('情報不足'));
});

test('formatUrgentLine は5要素を含む', () => {
  const t = formatUrgentLine({ what: 'x', owner: 'y', deadline: 'z', current_action: 'a', decision_needed: 'b' }, '2026-07-28');
  for (const h of ['【内容】', '【担当者】', '【期限】', '【現在の対応】', '【必要な判断】']) {
    assert.ok(t.includes(h));
  }
});

test('splitForLine: 長文は 4800字/5吹き出し に分割される', () => {
  const long = 'あ\n'.repeat(20000); // ~40000字
  const reqs = splitForLine(long);
  assert.ok(reqs.length >= 1);
  for (const group of reqs) {
    assert.ok(group.length <= 5, '1リクエスト5吹き出し以内');
    for (const bubble of group) assert.ok(bubble.length <= 4800, '1吹き出し4800字以内');
  }
});

test('parseJsonFromModel: ```json フェンス付きでもパースできる', () => {
  const o = parseJsonFromModel('前置き\n```json\n{"a":1,"b":[2,3]}\n```\n後置き');
  assert.deepEqual(o, { a: 1, b: [2, 3] });
});

test('normalizeReport: kintone形式をフラットにする', () => {
  const rec = { reporter: { value: '田中' }, dept: { value: 'EC運営' }, completion_rate: { value: '80' }, attachments: { value: [{ name: 'a.txt' }] } };
  const n = normalizeReport(rec);
  assert.equal(n.reporter, '田中');
  assert.equal(n.dept, 'EC運営');
  assert.deepEqual(n.attachments, ['a.txt']);
});

test('toAiReportRecord: kintone保存形式になる', () => {
  const r = toAiReportRecord(analysis, '2026-07-28', 'LINE本文');
  assert.equal(r.target_date.value, '2026-07-28');
  assert.equal(r.gen_status.value, '生成成功');
  assert.ok(r.ai_analysis.value.length > 0);
});

test('buildAnalysisInput: 件数を正しく数える', () => {
  const input = buildAnalysisInput('2026-07-28', [{ reporter: { value: 'a' } }, { reporter: { value: 'b' } }]);
  assert.equal(input.report_count, 2);
  assert.equal(input.reports.length, 2);
});
