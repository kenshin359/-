// ============================================================
//  楽天RMS「日次 店舗データ」の読み取りテスト
// ------------------------------------------------------------
//  一番こわいのは「デバイス別の行まで足してしまう」こと。
//  そのまま足すと売上が約2倍になり、社長に誤った数字を出します。
//  そこを必ず落とすことを、ここで固定します。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoreDaily, looksLikeStoreDaily, findHeaderRow, summarizeStoreDaily } from '../lib/rakutenStore.js';
import { parseCsv } from '../lib/csv.js';

// 実物と同じ形（注意書き2行 + 期間1行 + 見出し + 1日4行）
const SAMPLE = [
  '※この情報は店舗様および楽天市場での重要な情報となります。',
  '',
  'データ対象期間,2026/07/01 ～ 2026/07/02',
  '"日付","曜日","デバイス","売上金額","売上件数","アクセス人数","転換率","客単価"',
  '"2026/07/01","水","すべて",1199910,43,12728,0.34,27905',
  '"2026/07/01","水","PC",131080,5,152,3.29,26216',
  '"2026/07/01","水","楽天市場アプリ",933450,31,1464,2.12,30111',
  '"2026/07/01","水","スマートフォン",135380,7,11112,0.06,19340',
  '"2026/07/02","木","すべて",487238,20,13793,0.15,24362',
  '"2026/07/02","木","PC",35800,1,196,0.51,35800',
].join('\r\n');

const buf = Buffer.from(SAMPLE, 'utf8');

test('前に注意書きが入っていても、見出しの行を見つける', () => {
  const matrix = parseCsv(SAMPLE);
  const i = findHeaderRow(matrix);
  assert.ok(i > 0, '1行目より後ろにあること');
  assert.ok(matrix[i].some((c) => c.includes('日付')), '見つけた行に「日付」があること');
});

test('このファイル形式だと判別できる', () => {
  assert.equal(looksLikeStoreDaily(buf), true);
});

test('★デバイス別の行は足さない（売上が二重になるため）', () => {
  const r = readStoreDaily(buf);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2, '1日1行にまとめられていること');
  assert.equal(r.skippedDeviceRows, 4, "PC・アプリ・スマホのデバイス別4行を除外");

  // 「すべて」の値だけが入っていること
  assert.equal(r.rows[0].amount, 1199910);
  assert.equal(r.rows[0].orders, 43);
  assert.equal(r.rows[1].amount, 487238);

  // デバイス別を足していたら 2,399,820 になってしまう
  const total = r.rows.reduce((s, x) => s + x.amount, 0);
  assert.equal(total, 1199910 + 487238);
});

test('期間の転換率は、日ごとの平均ではなく 件数÷アクセス で出す', () => {
  const s = summarizeStoreDaily(readStoreDaily(buf));
  assert.equal(s.days, 2);
  assert.equal(s.orders, 63);
  assert.equal(s.access, 12728 + 13793);
  // 日ごとの転換率の平均 (0.34+0.15)/2 = 0.245% とは違う値になる
  assert.equal(s.cvr.toFixed(2), ((63 / 26521) * 100).toFixed(2));
  assert.equal(Math.round(s.aov), Math.round((1199910 + 487238) / 63));
});

test('商品別の内訳が無いことを、はっきり示す', () => {
  const r = readStoreDaily(buf);
  assert.equal(r.hasProductBreakdown, false);
});
