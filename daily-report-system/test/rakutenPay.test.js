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

// ── 日次CSV添付のテスト ──
import { rowsToCsv } from '../lib/salesDetailFiles.js';

test('日次CSVはExcelで開ける形（BOM付き・カンマや引用符も安全）', () => {
  const buf = rowsToCsv([
    { date: '2026-08-01', channel: '楽天', product: 'スーツケースM', confidence: '確定',
      sku: '207', asin: '', title: '多機能, "M"', qty: 2, amount: 71600 },
  ]);
  const s = buf.toString('utf8');
  assert.ok(s.startsWith('﻿'), 'BOMが付いていること（Excelの文字化け防止）');
  assert.ok(s.includes('日付,販売先,商品'), '見出しがあること');
  assert.ok(s.includes('"多機能, ""M"""'), 'カンマと引用符が壊れないこと');
  assert.ok(s.includes('71600'));
});

// ── クーポン値引きの按分（RMS店舗売上と一致させる基準） ──
import { applyCouponDiscount } from '../lib/rakutenPay.js';

test('クーポン値引きを商品金額の比率で按分し、合計がぴったり合う', () => {
  const rows = [
    { amount: 30000, qty: 1 },
    { amount: 10000, qty: 1 },
  ];
  applyCouponDiscount(rows, 1000);
  assert.equal(rows[0].amount + rows[1].amount, 39000);
  assert.equal(rows[0].amount, 29250); // 3/4を負担
  assert.equal(rows[1].amount, 9750);
});

test('端数が出ても1円単位で合計が値引き額と一致する', () => {
  const rows = [{ amount: 100 }, { amount: 100 }, { amount: 100 }];
  applyCouponDiscount(rows, 100); // 33.33…円ずつ割れない
  assert.equal(rows.reduce((s, r) => s + r.amount, 0), 200);
});

test('クーポンが商品合計を超えても0円未満にはならない', () => {
  const rows = [{ amount: 500 }];
  applyCouponDiscount(rows, 9999);
  assert.equal(rows[0].amount, 0);
});

test('クーポン0円・行なしでは何もしない', () => {
  const rows = [{ amount: 100 }];
  applyCouponDiscount(rows, 0);
  assert.equal(rows[0].amount, 100);
  applyCouponDiscount([], 100); // 例外にならないこと
});

test('注文にcouponAllTotalPriceがあれば行の合計から引かれる', () => {
  const o = {
    orderNumber: 'X-1', orderProgress: 300, orderDatetime: '2026-08-05 10:00:00',
    couponAllTotalPrice: 2000,
    PackageModelList: [{ ItemModelList: [
      { itemName: 'A', itemNumber: 'a1', price: 10000, units: 1 },
      { itemName: 'B', itemNumber: 'b1', price: 10000, units: 1 },
    ] }],
  };
  const { rows } = ordersToRows([o]);
  assert.equal(rows.reduce((s, r) => s + r.amount, 0), 18000);
});
