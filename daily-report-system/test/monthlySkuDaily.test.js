// ============================================================
//  月次SKU集計スクリプトのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・数字がA-Jに置き換わること（Actionsのマスク対策）
//    ・商品名の中のカンマ・引用符でCSVが壊れないこと
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDigits, parseCsv, aggregateSkuRows } from '../scripts/monthlySkuDaily.js';

test('数字は0-9→A-Jに置き換わる（29→CJ でマスクされない）', () => {
  assert.equal(encodeDigits('qty:296'), 'qty:CJG');
  assert.equal(encodeDigits('2026-07-01'), 'CACG-AH-AB');
  // 復号（読む側）: A-J → 0-9
  const decoded = 'CJG'.replace(/[A-J]/g, (c) => 'ABCDEFGHIJ'.indexOf(c));
  assert.equal(decoded, '296');
});

test('引用符つきCSVを正しく分解できる', () => {
  const rows = parseCsv('﻿日付,販売先,商品\r\n2026-07-01,楽天,"多機能, ""M"""\r\n');
  assert.deepEqual(rows[1], ['2026-07-01', '楽天', '多機能, "M"']);
});

test('SKU別に数量を合算する（見出し行は飛ばす）', () => {
  const csv = [
    ['日付', '販売先', '商品', '判定', 'SKU', 'ASIN', '商品名', '数量', '売上'],
    ['2026-07-01', '楽天', 'スーツケースM', '確定', '207', '', '多機能 M', '2', '71600'],
    ['2026-07-01', '楽天', 'スーツケースM', '確定', '207', '', '多機能 M', '1', '35800'],
    ['2026-07-01', '自社サイト', 'スーツケースS', '確定', '103', '', 'S', '1', '26800'],
  ];
  const agg = aggregateSkuRows(csv);
  assert.equal(agg.get('楽天|207'), 3);
  assert.equal(agg.get('自社サイト|103'), 1);
});
