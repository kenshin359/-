// ============================================================
//  売上検算（salesRecheck）のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・ずれが正しく検出されること（増えた・減った・両方）
//    ・一致している日は報告されないこと
//    ・「APIが0円なのにキントーンに数字」は自動修正対象外になること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDrift, daysAgoISO } from '../scripts/salesRecheck.js';

const DATES = ['2026-08-03', '2026-08-04'];
const CHS = ['楽天', '自社サイト'];

test('反映遅れ（増加）とキャンセル（減少）を両方検出する', () => {
  const kintone = {
    '2026-08-04': { 楽天: 2081340, 自社サイト: 612890 },
    '2026-08-03': { 楽天: 1654360, 自社サイト: 325060 },
  };
  const fresh = {
    '2026-08-04': { 楽天: 2426100, 自社サイト: 594560 },
    '2026-08-03': { 楽天: 1654360, 自社サイト: 325060 },
  };
  const drifts = computeDrift(kintone, fresh, DATES, CHS);
  assert.equal(drifts.length, 2);
  const rk = drifts.find((x) => x.channel === '楽天');
  assert.equal(rk.diff, 344760);
  assert.equal(rk.fixable, true);
  const sp = drifts.find((x) => x.channel === '自社サイト');
  assert.equal(sp.diff, -18330);
});

test('一致していれば何も報告しない', () => {
  const same = { '2026-08-04': { 楽天: 100, 自社サイト: 200 } };
  assert.deepEqual(computeDrift(same, same, ['2026-08-04'], CHS), []);
});

test('APIが0円なのにキントーンに数字がある日は fixable=false', () => {
  const kintone = { '2026-08-04': { 楽天: 50000 } };
  const fresh = {};
  const [d] = computeDrift(kintone, fresh, ['2026-08-04'], ['楽天']);
  assert.equal(d.fixable, false);
  assert.equal(d.diff, -50000);
});

test('キントーンに無い日がAPIにあれば取込漏れとして検出する', () => {
  const kintone = {};
  const fresh = { '2026-08-04': { 楽天: 999 } };
  const [d] = computeDrift(kintone, fresh, ['2026-08-04'], ['楽天']);
  assert.equal(d.diff, 999);
  assert.equal(d.fixable, true);
});

test('daysAgoISO は日本時間の基準日から正しく引く', () => {
  assert.equal(daysAgoISO(1, '2026-08-05'), '2026-08-04');
  assert.equal(daysAgoISO(3, '2026-08-01'), '2026-07-29');
});
