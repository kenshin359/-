// ============================================================
//  楽天ペイ受注API連携のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・キャンセル注文（進行状況800/900）を数えないこと
//    ・金額は 単価×数量 であること
//    ・SKU移行後の店舗でも SKU番号を拾えること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersToRows, isCancelledProgress, rmsDatetime, esaAuthHeader } from '../lib/rakutenPay.js';

function order(overrides = {}) {
  return {
    orderNumber: '407466-20260731-00000001',
    orderDatetime: '2026-07-31T10:12:34+0900',
    orderProgress: 300,
    PackageModelList: [
      {
        ItemModelList: [
          {
            itemName: '多機能スーツケース Mサイズ',
            itemNumber: 'suitcase-m',
            manageNumber: 'suitcase-m',
            price: 35800,
            units: 2,
            SkuModelList: [{ merchantDefinedSkuId: '207' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

test('単価×数量で計算する（まとめ買いを1個ぶんにしない）', () => {
  const { rows } = ordersToRows([order()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 71600);
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[0].date, '2026-07-31');
  assert.equal(rows[0].channel, '楽天');
});

test('★キャンセル注文は数えない', () => {
  const { rows, skipped } = ordersToRows([
    order(),
    order({ orderNumber: 'x-2', orderProgress: 900 }),
    order({ orderNumber: 'x-3', orderProgress: 800 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(skipped.cancelled, 2);
  assert.ok(isCancelledProgress(900));
  assert.ok(isCancelledProgress('800'));
  assert.ok(!isCancelledProgress(500));
});

test('SKUは「システム連携用SKU番号」を最優先で拾う', () => {
  const { rows } = ordersToRows([order()]);
  assert.equal(rows[0].sku, '207');

  // SKU番号が無い古い商品は、商品番号にフォールバック
  const noSku = order();
  noSku.PackageModelList[0].ItemModelList[0].SkuModelList = [];
  const r2 = ordersToRows([noSku]);
  assert.equal(r2.rows[0].sku, 'suitcase-m');
});

test('RMSに渡す日時の形（+0900・コロンなし）', () => {
  assert.equal(rmsDatetime('2026-07-31'), '2026-07-31T00:00:00+0900');
  assert.equal(rmsDatetime('2026-07-31', true), '2026-07-31T23:59:59+0900');
});

test('認証ヘッダーは ESA + base64(secret:key)', () => {
  const h = esaAuthHeader('SPtest', 'SLtest');
  assert.ok(h.startsWith('ESA '));
  assert.equal(Buffer.from(h.slice(4), 'base64').toString(), 'SPtest:SLtest');
});
