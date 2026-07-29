// ============================================================
//  画像日報の抽出テスト
// ------------------------------------------------------------
//  実際の日報アプリは「氏名」と「日報画像」がフィールドコード末尾の
//  番号で対応する構造。ここがずれると別人の日報を報告してしまうため、
//  対応関係を重点的に検証する。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractImageReports, filterByDate, availableDates, normalizeName,
} from '../lib/extractImages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const { records } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'samples/sample-image-report-record.json'), 'utf8')
);

test('サブテーブルから 日付・氏名・画像 を取り出せる', () => {
  const got = extractImageReports(records);
  assert.equal(got.length, 3, '提出3件（画像が無い列は除外）');
  assert.equal(got[0].date, '2026-07-01');
  assert.equal(got[0].team, 'TeamA');
});

test('氏名と日報画像の対応がずれない（末尾番号でペアリング）', () => {
  const got = extractImageReports(records);
  const day1 = filterByDate(got, '2026-07-01');
  assert.deepEqual(day1.map((r) => r.reporter), ['山田太郎', '鈴木花子']);
  assert.equal(day1[0].files[0].name, 'nippou_a.png', '山田＝a');
  assert.equal(day1[1].files[0].name, 'nippou_b.jpg', '鈴木＝b');
});

test('画像が無い列（未提出）は除外される', () => {
  const got = extractImageReports(records);
  assert.ok(!got.some((r) => r.reporter === '未提出者'), '未提出者を含めてはいけない');
});

test('日付一覧が新しい順で取れる', () => {
  assert.deepEqual(availableDates(extractImageReports(records)), ['2026-07-02', '2026-07-01']);
});

test('氏名の表記ゆれを揃えられる', () => {
  assert.equal(normalizeName('関本 彩乃'), '関本彩乃');
  assert.equal(normalizeName('関本　彩乃'), '関本彩乃');
  assert.equal(normalizeName(null), null);
});

test('空・壊れた入力でも落ちない', () => {
  assert.deepEqual(extractImageReports([]), []);
  assert.deepEqual(extractImageReports(null), []);
  assert.deepEqual(extractImageReports([null, 'ゴミ', { $id: { value: '1' } }]), []);
});
