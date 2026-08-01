// ============================================================
//  Amazon SP-API連携のテスト
// ------------------------------------------------------------
//  守りたいのは2つ。
//    ・日本時間の1日を、正しくUTCに直せること（ずれると前日の売上が混ざる）
//    ・SP-APIの注文レポート（タブ区切り）を、既存の読み取りで読めること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeToUtc, MARKETPLACE_JP, ORDERS_REPORT_TYPE } from '../lib/spapi.js';
import { readSalesReport } from '../lib/salesDetail.js';

test('日本時間の1日 → UTCの範囲（9時間ずれる）', () => {
  const { dataStartTime, dataEndTime } = rangeToUtc('2026-07-31', '2026-07-31');
  assert.equal(dataStartTime, '2026-07-30T15:00:00.000Z');
  assert.equal(dataEndTime, '2026-07-31T14:59:59.000Z');
});

test('複数日の範囲も正しい', () => {
  const { dataStartTime, dataEndTime } = rangeToUtc('2026-07-01', '2026-07-31');
  assert.equal(dataStartTime, '2026-06-30T15:00:00.000Z');
  assert.equal(dataEndTime, '2026-07-31T14:59:59.000Z');
});

test('マーケットプレイスは日本、レポートは個人情報なしのGENERAL', () => {
  assert.equal(MARKETPLACE_JP, 'A1VC38T7YXB528');
  assert.ok(ORDERS_REPORT_TYPE.endsWith('_GENERAL'), '購入者情報つきレポートを使わないこと');
});

/** SP-APIが返す注文レポート（タブ区切り）のミニチュア */
function sampleReport() {
  const rows = [
    ['amazon-order-id', 'purchase-date', 'order-status', 'product-name', 'sku', 'asin', 'quantity', 'currency', 'item-price'],
    ['503-0000001-0000001', '2026-07-31T10:12:34+09:00', 'Shipped', '多機能スーツケース Mサイズ', '207', 'B0TESTM207', '1', 'JPY', '35800'],
    ['503-0000002-0000002', '2026-07-31T11:00:00+09:00', 'Unshipped', 'ハンディファン', 'F53K02', 'B0FF8NXGXC', '2', 'JPY', '3200'],
    // キャンセルは数えない
    ['503-0000003-0000003', '2026-07-31T12:00:00+09:00', 'Cancelled', '多機能スーツケース Sサイズ', '101', 'B0F8Q2TTBT', '1', 'JPY', '26800'],
  ];
  return Buffer.from(rows.map((r) => r.join('\t')).join('\n'), 'utf8');
}

test('★SP-APIの注文レポートを読める（タブ区切り・日付・キャンセル除外）', () => {
  const r = readSalesReport(sampleReport(), { channel: 'Amazon' });
  assert.ok(r.ok, r.reason);
  assert.equal(r.rows.length, 2, 'キャンセルを除いた2行');
  assert.equal(r.skipped.cancelled, 1);

  const m = r.rows.find((x) => x.sku === '207');
  assert.equal(m.date, '2026-07-31', '+09:00付きの日時から日本の日付が取れること');
  assert.equal(m.amount, 35800);
  assert.equal(m.channel, 'Amazon');

  const fan = r.rows.find((x) => x.sku === 'F53K02');
  assert.equal(fan.qty, 2);
});
