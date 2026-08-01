// ============================================================
//  Shopify 注文エクスポートCSVの読み取りテスト
// ------------------------------------------------------------
//  このファイルで一番こわいのは、間違えても「エラーにならない」ことです。
//    ・2行目以降は注文日が空 → 普通に読むと黙って捨てられる
//    ・金額は単価 → 数量を掛け忘れると、まとめ買いが1個ぶんになる
//  どちらも売上が静かに減るだけなので、ここで固定します。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readShopifyOrders,
  looksLikeShopifyOrders,
  isTestOrder,
  describeSubtotalGap,
} from '../lib/shopifyCsv.js';

const HEADER = [
  'Name', 'Email', 'Financial Status', 'Paid at', 'Fulfillment Status', 'Currency',
  'Subtotal', 'Shipping', 'Taxes', 'Total', 'Created at',
  'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem sku', 'Lineitem discount',
  'Cancelled at', 'Payment Method', 'Refunded Amount',
].join(',');

/** 1行ぶんを組み立てる（省略した列は空） */
function row(v = {}) {
  const get = (k) => (v[k] === undefined ? '' : String(v[k]));
  return [
    get('name'), get('email'), get('financial'), '', '', 'JPY',
    get('subtotal'), get('shipping'), get('taxes'), get('total'), get('created'),
    get('qty'), get('item'), get('price'), get('sku'), get('discount'),
    get('cancelled'), get('payment'), get('refunded'),
  ].join(',');
}

function csv(...lines) {
  return Buffer.from([HEADER, ...lines].join('\r\n'), 'utf8');
}

test('Shopifyの注文CSVだと判別できる', () => {
  const buf = csv(row({ name: '#1001', created: '2026-07-31 10:00:00 +0900', qty: 1, item: 'A', price: 100 }));
  assert.equal(looksLikeShopifyOrders(buf), true);
});

test('★2行目以降は注文日が空でも、同じ注文の日付を引き継ぐ', () => {
  const buf = csv(
    row({ name: '#1001', created: '2026-07-31 10:00:00 +0900', subtotal: 30000,
          qty: 1, item: 'スーツケースS', price: 26800, sku: '101' }),
    // ★2行目: Shopifyは注文日を空にする
    row({ name: '#1001', qty: 2, item: 'ハンディファン', price: 1600, sku: 'F53K02' })
  );
  const r = readShopifyOrders(buf);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2, '2行目が捨てられていないこと');
  assert.equal(r.rows[1].date, '2026-07-31', '1行目の注文日を引き継ぐこと');
  assert.equal(r.skipped.noDate, 0);
});

test('★金額は「単価 × 数量」（掛け忘れるとまとめ買いが1個ぶんになる）', () => {
  const buf = csv(
    row({ name: '#1001', created: '2026-07-31 10:00:00 +0900',
          qty: 3, item: 'ハンディファン', price: 1600, sku: 'F53K02' })
  );
  const r = readShopifyOrders(buf);
  assert.equal(r.rows[0].amount, 4800);
  assert.equal(r.rows[0].qty, 3);
});

test('商品ごとの割引は差し引く', () => {
  const buf = csv(
    row({ name: '#1001', created: '2026-07-31 10:00:00 +0900',
          qty: 2, item: 'ハンディファン', price: 1600, discount: 500 })
  );
  assert.equal(readShopifyOrders(buf).rows[0].amount, 3200 - 500);
});

test('キャンセルされた注文は、行が何行あっても1件として除外する', () => {
  const buf = csv(
    row({ name: '#1001', created: '2026-07-31 10:00:00 +0900', qty: 1, item: 'A', price: 100 }),
    row({ name: '#1002', created: '2026-07-31 11:00:00 +0900', qty: 1, item: 'B', price: 200,
          cancelled: '2026-07-31 12:00:00 +0900' }),
    row({ name: '#1002', qty: 1, item: 'C', price: 300 })
  );
  const r = readShopifyOrders(buf);
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.cancelled, 1, '行数ではなく注文数で数えること');
});

test('テスト注文（Bogus Gateway）は数えない', () => {
  assert.equal(isTestOrder('Bogus Gateway'), true);
  assert.equal(isTestOrder('クレジットカード'), false);

  const buf = csv(
    row({ name: '#1001', created: '2026-07-31 10:00:00 +0900', qty: 1, item: 'A', price: 100,
          payment: 'Bogus Gateway' }),
    row({ name: '#1002', created: '2026-07-31 10:00:00 +0900', qty: 1, item: 'B', price: 200,
          payment: 'クレジットカード' })
  );
  const r = readShopifyOrders(buf);
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.test, 1);
});

test('返品額は差し引かず、金額だけ報告する（Amazonと揃えるため）', () => {
  const buf = csv(
    row({ name: '#1001', created: '2026-07-31 10:00:00 +0900', qty: 1, item: 'A', price: 5000,
          refunded: 5000 })
  );
  const r = readShopifyOrders(buf);
  assert.equal(r.rows[0].amount, 5000, '売上はそのまま');
  assert.equal(r.refunded, 5000, '返品額は別に出す');
});

test('注文数は、行数ではなく注文の数で数える', () => {
  const buf = csv(
    row({ name: '#1001', created: '2026-07-31 10:00:00 +0900', qty: 1, item: 'A', price: 100 }),
    row({ name: '#1001', qty: 1, item: 'B', price: 100 }),
    row({ name: '#1002', created: '2026-07-31 11:00:00 +0900', qty: 1, item: 'C', price: 100 })
  );
  assert.equal(readShopifyOrders(buf).orders, 2);
});

test('販売先は「自社サイト」になる', () => {
  const buf = csv(row({ name: '#1', created: '2026-07-31 10:00:00 +0900', qty: 1, item: 'A', price: 1 }));
  assert.equal(readShopifyOrders(buf).rows[0].channel, '自社サイト');
});

test('小計と大きくズレたら報告する（税設定の取り違えに気づくため）', () => {
  // 税別ストアなら、明細の合計が小計を10%上回る/下回る形でズレる
  const ok = csv(
    row({ name: '#1', created: '2026-07-31 10:00:00 +0900', subtotal: 10000,
          qty: 1, item: 'A', price: 10000 })
  );
  assert.equal(describeSubtotalGap(readShopifyOrders(ok)), null, 'ぴったりなら何も言わない');

  const gap = csv(
    row({ name: '#1', created: '2026-07-31 10:00:00 +0900', subtotal: 9091,
          qty: 1, item: 'A', price: 10000 })
  );
  const msg = describeSubtotalGap(readShopifyOrders(gap));
  assert.ok(msg && msg.includes('税設定'), '税設定の可能性を伝えること');
});

test('Shopifyの注文CSVでなければ、理由を返して止まる', () => {
  const other = Buffer.from('日付,売上\n2026-07-31,1000\n', 'utf8');
  const r = readShopifyOrders(other);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('Shopify'));
});
