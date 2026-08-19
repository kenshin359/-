// ============================================================
//  進捗シート用データ集めのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・在庫報告アプリのサブテーブルを正しく行に展開する
//    ・数値でない在庫数が入っても落ちない（0扱い）
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStockRows } from '../scripts/choreiSheetData.js';

test('在庫報告のサブテーブルを行に展開できる', () => {
  const rec = {
    stock_rows: {
      value: [
        {
          value: {
            st_product: { value: 'スーツケースS' },
            st_sku: { value: 'ホワイト' },
            st_qty: { value: '144' },
            st_memo: { value: '倉庫Bぶん含む' },
          },
        },
        {
          value: {
            st_product: { value: 'ハンディファン(首振り)' },
            st_qty: { value: '52' },
          },
        },
      ],
    },
  };
  const rows = parseStockRows(rec);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    product: 'スーツケースS',
    sku: 'ホワイト',
    qty: 144,
    memo: '倉庫Bぶん含む',
  });
  assert.equal(rows[1].qty, 52);
  assert.equal(rows[1].sku, '');
});

test('在庫数が空や文字でも0として扱う', () => {
  const rec = {
    stock_rows: {
      value: [
        { value: { st_product: { value: 'その他' }, st_qty: { value: '' } } },
        { value: { st_product: { value: 'その他' }, st_qty: { value: '未定' } } },
      ],
    },
  };
  const rows = parseStockRows(rec);
  assert.equal(rows[0].qty, 0);
  assert.equal(rows[1].qty, 0);
});

test('レコードなし・サブテーブルなしでも空配列', () => {
  assert.deepEqual(parseStockRows(null), []);
  assert.deepEqual(parseStockRows({}), []);
});
