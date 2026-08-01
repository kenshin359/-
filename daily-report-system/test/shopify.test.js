// ============================================================
//  Shopify連携のテスト
// ------------------------------------------------------------
//  ここを間違えると売上そのものがずれます。
//    ・税込設定と税別設定で、足す・足さないが変わる
//    ・キャンセル注文とテスト注文を数えない
//    ・UTCのまま日付を切ると、朝9時前の注文が前日に入る
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { orderToRows, ordersToRows, toLocalDate, ordersQueryString } from '../lib/shopify.js';
import { yesterdayISO, resolveRange } from '../scripts/shopifyImport.js';

function line(sku, title, qty, amount, tax = 0) {
  return {
    sku,
    title,
    quantity: qty,
    discountedTotalSet: { shopMoney: { amount: String(amount) } },
    taxLines: tax ? [{ priceSet: { shopMoney: { amount: String(tax) } } }] : [],
  };
}

function order(over = {}) {
  return {
    id: 'gid://shopify/Order/1',
    name: '#1001',
    createdAt: '2026-07-15T03:00:00Z', // 日本時間 7/15 12:00
    cancelledAt: null,
    test: false,
    taxesIncluded: true,
    lineItems: { pageInfo: { hasNextPage: false }, nodes: [line('101', 'スーツケースS', 1, 26800)] },
    ...over,
  };
}

test('税込設定のときは、税を足さない（二重計上になるため）', () => {
  const rows = orderToRows(order({ taxesIncluded: true, lineItems: {
    pageInfo: { hasNextPage: false }, nodes: [line('101', 'S', 1, 26800, 2436)],
  } }));
  assert.equal(rows[0].amount, 26800);
});

test('税別設定のときは、税を足す（Amazonの税込金額と比べられなくなるため）', () => {
  const rows = orderToRows(order({ taxesIncluded: false, lineItems: {
    pageInfo: { hasNextPage: false }, nodes: [line('101', 'S', 1, 26800, 2680)],
  } }));
  assert.equal(rows[0].amount, 26800 + 2680);
});

test('★UTCではなく日本時間で日付を決める', () => {
  // UTC 7/14 22:00 = 日本時間 7/15 07:00
  assert.equal(toLocalDate('2026-07-14T22:00:00Z'), '2026-07-15');
  // UTC 7/15 00:30 = 日本時間 7/15 09:30
  assert.equal(toLocalDate('2026-07-15T00:30:00Z'), '2026-07-15');
  // UTC 7/15 15:30 = 日本時間 7/16 00:30（日をまたぐ）
  assert.equal(toLocalDate('2026-07-15T15:30:00Z'), '2026-07-16');
});

test('キャンセルとテスト注文は売上に数えない', () => {
  const r = ordersToRows([
    order(),
    order({ id: 'x2', cancelledAt: '2026-07-16T00:00:00Z' }),
    order({ id: 'x3', test: true }),
  ]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.cancelled, 1);
  assert.equal(r.skipped.test, 1);
});

test('商品が100点を超えた注文は、読み切れなかったと申告する', () => {
  const r = ordersToRows([
    order({ lineItems: { pageInfo: { hasNextPage: true }, nodes: [line('101', 'S', 1, 100)] } }),
  ]);
  assert.equal(r.truncatedLineItems, 1, '黙って切り捨てず、件数を出すこと');
});

test('1注文に複数商品が入っていれば、商品ごとに分ける', () => {
  const rows = orderToRows(order({ lineItems: { pageInfo: { hasNextPage: false }, nodes: [
    line('101', 'スーツケースS', 1, 26800),
    line('F53K01', 'ハンディファン', 2, 3960),
  ] } }));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].qty, 2);
  assert.equal(rows[1].sku, 'F53K01');
  assert.ok(rows.every((r) => r.channel === '自社サイト'));
  assert.ok(rows.every((r) => r.date === '2026-07-15'));
});

test('期間の指定は日本時間の0:00〜23:59で作る', () => {
  const q = ordersQueryString('2026-07-01', '2026-07-31');
  assert.ok(q.includes("created_at:>='2026-07-01T00:00:00+09:00'"));
  assert.ok(q.includes("created_at:<='2026-07-31T23:59:59+09:00'"));
});

test('昨日の日付は、月をまたいでも正しい', () => {
  assert.equal(yesterdayISO('2026-08-01'), '2026-07-31');
  assert.equal(yesterdayISO('2026-03-01'), '2026-02-28');
  assert.equal(yesterdayISO('2026-01-01'), '2025-12-31');
});

test('期間の引数の解釈', () => {
  assert.deepEqual(resolveRange(['--date=2026-07-05']), { from: '2026-07-05', to: '2026-07-05' });
  assert.deepEqual(resolveRange(['--from=2026-07-01', '--to=2026-07-31']), {
    from: '2026-07-01', to: '2026-07-31',
  });
  // 片方だけなら、その1日として扱う（期間が空にならないように）
  assert.deepEqual(resolveRange(['--from=2026-07-09']), { from: '2026-07-09', to: '2026-07-09' });
});
