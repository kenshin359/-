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
import { authHeadersFor } from '../lib/kintone.js';

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

// ── Kintone 認証方式の選択 ────────────────────────────────
// APIトークン（最小権限）が設定されていれば必ずそちらを優先すること。
// パスワードは権限が広いので、フォールバックに留める。

test('authHeadersFor: APIトークンがあればトークン認証を使う', () => {
  process.env.KINTONE_USER = 'u';
  process.env.KINTONE_PASSWORD = 'p';
  const h = authHeadersFor('my-token');
  assert.equal(h['X-Cybozu-API-Token'], 'my-token');
  assert.ok(!h['X-Cybozu-Authorization'], 'トークンがある時はパスワードを送らない');
});

test('authHeadersFor: トークンが無ければパスワード認証にフォールバック', () => {
  process.env.KINTONE_USER = 'user1';
  process.env.KINTONE_PASSWORD = 'pass1';
  const h = authHeadersFor(null);
  assert.ok(!h['X-Cybozu-API-Token']);
  assert.equal(
    Buffer.from(h['X-Cybozu-Authorization'], 'base64').toString('utf8'),
    'user1:pass1'
  );
});

test('authHeadersFor: 認証情報が全く無ければ分かりやすいエラー', () => {
  delete process.env.KINTONE_USER;
  delete process.env.KINTONE_PASSWORD;
  assert.throws(() => authHeadersFor(null), /認証情報がありません|npm run setup/);
});

// ── 実際の日報アプリ構造からの抽出 ──────────────────────
// リベティの日報アプリは「1レコード＝1チームの数日分、日付ごとのテーブルに
// 複数人の氏名＋本文が横に並ぶ」構造。フィールドコードが不明でも
// "形" から日付・氏名・本文を取り出せることを確認する。

import { extractReports, filterByDate, buildInputFromExtracted, looksLikeDate, toDateISO } from '../lib/extractReports.js';

const rec33 = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'samples/sample-kintone-record33.json'), 'utf8')
).records;

test('extractReports: サブテーブル構造から日付・氏名・本文を取り出す', () => {
  const got = extractReports(rec33);
  assert.equal(got.length, 6, '2日分 × 3名 = 6件');

  const first = got[0];
  assert.equal(first.date, '2026-07-01');
  assert.equal(first.reporter, 'ミツワ');
  assert.equal(first.team, 'LP');
  assert.ok(first.text.includes('楽天の受注処理'));
});

test('extractReports: 氏名と本文の対応がずれない', () => {
  const got = extractReports(rec33);
  const day1 = got.filter((r) => r.date === '2026-07-01');
  assert.deepEqual(day1.map((r) => r.reporter), ['ミツワ', '三浦', '久保']);
  // 久保の本文にクレームの記載があること（＝取り違えていない）
  assert.ok(day1[2].text.includes('クレーム'));
});

test('filterByDate: 対象日だけに絞れる', () => {
  const got = extractReports(rec33);
  assert.equal(filterByDate(got, '2026-07-01').length, 3);
  assert.equal(filterByDate(got, '2026-07-02').length, 3);
  assert.equal(filterByDate(got, '2026-07-09').length, 0);
});

test('extractReports: 空・壊れた入力でも落ちない', () => {
  assert.deepEqual(extractReports([]), []);
  assert.deepEqual(extractReports(null), []);
  assert.deepEqual(extractReports([null, undefined, 'ゴミ']), []);
  assert.deepEqual(extractReports([{ $id: { value: '1' } }]), []);
});

test('extractReports: サブテーブルが無く本文が直置きでも拾える', () => {
  const flat = [
    {
      $id: { value: '1' },
      hiduke: { type: 'DATE', value: '2026-07-05' },
      shimei: { type: 'SINGLE_LINE_TEXT', value: '田中' },
      honbun: { type: 'MULTI_LINE_TEXT', value: '本日は在庫の棚卸しを行いました。特に問題はありません。' },
    },
  ];
  const got = extractReports(flat);
  assert.equal(got.length, 1);
  assert.equal(got[0].date, '2026-07-05');
  assert.equal(got[0].reporter, '田中');
});

test('looksLikeDate / toDateISO: 日時からも日付を取り出せる', () => {
  assert.ok(looksLikeDate('2026-07-01T10:37:00Z'));
  assert.ok(looksLikeDate('2026-07-01'));
  assert.ok(!looksLikeDate('ミツワ'));
  assert.equal(toDateISO('2026-07-01T10:37:00Z'), '2026-07-01');
});

test('buildInputFromExtracted: Claude入力の形になる', () => {
  const got = extractReports(rec33);
  const input = buildInputFromExtracted('2026-07-01', filterByDate(got, '2026-07-01'));
  assert.equal(input.report_count, 3);
  assert.equal(input.reports[0].reporter, 'ミツワ');
  assert.ok(input.reports[0].body.length > 0);
  assert.ok(input.note.includes('自由記述'));
});
