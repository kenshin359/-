// ============================================================
//  売上の自動紐づけのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・キャンセル・返品を売上に数えない
//    ・SKU/ASIN の対応表にあるものだけを「確定」にする
//    ・商品名からの推測を「確定」だと言い張らない
//    ・日付をまたいで商品をまとめない
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readSalesReport, aggregateByProduct, mapProduct, isCancelled, pickColumn, COLUMNS,
} from '../lib/salesDetail.js';
import {
  FIELDS, dedupKey, flattenDetail, productOptions, CHANNEL_OPTIONS,
} from '../kintone/salesDetailSchema.js';
import { VIEWS, REPORTS } from '../kintone/salesDetailViews.js';

const enc = (s) => Buffer.from(s, 'utf8');

// Amazon 注文レポート（タブ区切り・英語見出し）
const ORDER_TSV = [
  'amazon-order-id\tpurchase-date\tsku\tasin\tproduct-name\tquantity-purchased\titem-price\torder-status',
  '249-1\t2026-07-30T09:12:00+09:00\tLBT-FAN-KUBI-BK\tB0AAA111\tLibetee ハンディファン 首振り ブラック\t2\t7980\tShipped',
  '249-2\t2026-07-30T11:40:00+09:00\tLBT-SC-M\tB0AAA222\tLibetee スーツケース Mサイズ\t1\t29800\tShipped',
  '249-3\t2026-07-30T15:20:00+09:00\tLBT-SC-M\tB0AAA222\tLibetee スーツケース Mサイズ\t1\t29800\tCancelled',
  '249-4\t2026-07-31T08:05:00+09:00\tLBT-FAN-KUBI-BK\tB0AAA111\tLibetee ハンディファン 首振り ブラック\t3\t11970\tShipped',
].join('\n');

// Amazon ビジネスレポート（日本語見出し・カンマ区切り）
const BIZ_CSV = [
  '日付,(子)ASIN,SKU,商品名,セッション,注文された商品点数,注文商品売上額',
  '2026/07/30,B0AAA111,LBT-FAN-KUBI-BK,Libetee ハンディファン 首振り ブラック,1240,2,"7,980"',
].join('\n');

const MAP = {
  bySku: new Map([['LBT-FAN-KUBI-BK', 'ハンディファン(首振り)']]),
  byAsin: new Map([['B0AAA222', 'スーツケースM']]),
  size: 2,
};

// ── 読み取り ──────────────────────────────────────

test('Amazon注文レポート（英語見出し・タブ区切り）を読める', () => {
  const r = readSalesReport(enc(ORDER_TSV), { channel: 'Amazon' });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 3); // キャンセル1件を除いた数
  assert.equal(r.rows[0].sku, 'LBT-FAN-KUBI-BK');
  assert.equal(r.rows[0].qty, 2);
  assert.equal(r.rows[0].amount, 7980);
  assert.equal(r.rows[0].date, '2026-07-30');
});

test('Amazonビジネスレポート（日本語見出し）も同じ形に読める', () => {
  const r = readSalesReport(enc(BIZ_CSV), { channel: 'Amazon' });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].qty, 2);
  assert.equal(r.rows[0].amount, 7980); // "7,980" のカンマも読める
  assert.equal(r.rows[0].asin, 'B0AAA111');
});

test('★キャンセル・返品を売上に数えない', () => {
  const r = readSalesReport(enc(ORDER_TSV), { channel: 'Amazon' });
  assert.equal(r.skipped.cancelled, 1);
  const total = r.rows.reduce((s, x) => s + x.amount, 0);
  assert.equal(total, 7980 + 29800 + 11970); // キャンセルの29800は入らない
});

test('キャンセルの判定（表記ゆれに対応）', () => {
  for (const s of ['Cancelled', 'キャンセル', 'Returned', '返品', 'Refunded']) {
    assert.equal(isCancelled(s), true, `${s} を除外できていません`);
  }
  for (const s of ['Shipped', '出荷済み', 'Pending', '']) {
    assert.equal(isCancelled(s), false, `${s} を誤って除外しています`);
  }
});

test('必要な列が無ければ、理由つきで読めないと返す', () => {
  const r = readSalesReport(enc('あ,い,う\n1,2,3'), { channel: 'Amazon' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /日付/);
  assert.match(r.reason, /見出し/); // 実際の見出しを見せて直せるようにする
});

test('列名の候補から実際の列を探せる（完全一致→部分一致）', () => {
  assert.equal(pickColumn(['購入日', '数量'], COLUMNS.date), '購入日');
  assert.equal(pickColumn(['注文商品売上額'], COLUMNS.amount), '注文商品売上額');
  assert.equal(pickColumn(['なし'], COLUMNS.date), null);
});

// ── 商品の紐づけ ──────────────────────────────────

test('SKUが対応表にあれば確定', () => {
  const m = mapProduct({ sku: 'LBT-FAN-KUBI-BK', title: '何か' }, MAP);
  assert.equal(m.product, 'ハンディファン(首振り)');
  assert.equal(m.confidence, '確定');
  assert.equal(m.matchedBy, 'SKU');
});

test('ASINが対応表にあれば確定', () => {
  const m = mapProduct({ asin: 'B0AAA222', title: '何か' }, MAP);
  assert.equal(m.product, 'スーツケースM');
  assert.equal(m.confidence, '確定');
});

test('SKUは大文字小文字を区別しない', () => {
  assert.equal(mapProduct({ sku: 'lbt-fan-kubi-bk' }, MAP).confidence, '確定');
  assert.equal(mapProduct({ sku: ' LBT-FAN-KUBI-BK ' }, MAP).confidence, '確定');
});

test('★商品名からの推測は必ず「要確認」にする（断定しない）', () => {
  const m = mapProduct({ sku: 'UNKNOWN-1', title: 'Libetee ハンディファン スケルトン ホワイト' }, MAP);
  assert.equal(m.product, 'ハンディファン(スケルトン)'); // 推測はする
  assert.equal(m.confidence, '要確認'); // が、確定とは言わない
  assert.equal(m.matchedBy, '商品名から推測');
});

test('まったく分からなければ未分類（適当な商品に付けない）', () => {
  const m = mapProduct({ sku: 'X', title: '謎の商品' }, MAP);
  assert.equal(m.product, '未分類');
  assert.equal(m.confidence, '要確認');
});

// ── 集計 ──────────────────────────────────────────

test('★日付をまたいで商品をまとめない', () => {
  const r = readSalesReport(enc(ORDER_TSV), { channel: 'Amazon' });
  const { rows } = aggregateByProduct(r.rows, MAP);
  const kubi = rows.filter((x) => x.product === 'ハンディファン(首振り)');
  assert.equal(kubi.length, 2, '7/30と7/31が1件に合算されています');
  assert.deepEqual(kubi.map((x) => x.date).sort(), ['2026-07-30', '2026-07-31']);
  assert.equal(kubi.find((x) => x.date === '2026-07-30').amount, 7980);
  assert.equal(kubi.find((x) => x.date === '2026-07-31').amount, 11970);
});

test('同じ日・同じ商品はまとめる', () => {
  const csv = [
    'purchase-date,sku,product-name,quantity-purchased,item-price',
    '2026-07-30,LBT-FAN-KUBI-BK,A,1,1000',
    '2026-07-30,LBT-FAN-KUBI-BK,A,2,2000',
  ].join('\n');
  const r = readSalesReport(enc(csv), { channel: 'Amazon' });
  const { rows } = aggregateByProduct(r.rows, MAP);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 3);
  assert.equal(rows[0].amount, 3000);
});

test('未登録のSKUを、金額つきで報告する', () => {
  const r = readSalesReport(enc(ORDER_TSV), { channel: 'Amazon' });
  const emptyMap = { bySku: new Map(), byAsin: new Map(), size: 0 };
  const { unmapped } = aggregateByProduct(r.rows, emptyMap);
  assert.ok(unmapped.length >= 1);
  // 金額の大きい順（対応が必要なものから見られるように）
  for (let i = 1; i < unmapped.length; i++) {
    assert.ok(unmapped[i - 1].amount >= unmapped[i].amount);
  }
});

test('空のファイルでも落ちない', () => {
  const { rows, unmapped } = aggregateByProduct([], MAP);
  assert.deepEqual(rows, []);
  assert.deepEqual(unmapped, []);
});

// ── kintone アプリの定義 ──────────────────────────

test('売上と数量は別の欄で持ち、平均単価は計算式', () => {
  const sub = FIELDS.detail.fields;
  assert.equal(sub.s_amount.type, 'NUMBER');
  assert.equal(sub.s_qty.type, 'NUMBER');
  assert.equal(sub.s_unit_price.type, 'CALC');
  // ★0で割らない（返品で数量0になる日がある）
  assert.match(sub.s_unit_price.expression, /IF\(s_qty > 0/);
});

test('紐づけの状態を残す欄がある', () => {
  const sub = FIELDS.detail.fields;
  assert.equal(sub.s_confidence.type, 'DROP_DOWN');
  assert.ok(sub.s_confidence.options['確定']);
  assert.ok(sub.s_confidence.options['要確認']);
  // 元の商品名を残す（あとから対応表を作れるように）
  assert.equal(sub.s_title.type, 'SINGLE_LINE_TEXT');
});

test('販売先の選択肢に4チャネルが入っている', () => {
  for (const c of ['Amazon', '楽天', '自社サイト', 'TikTok Shop']) {
    assert.ok(CHANNEL_OPTIONS.includes(c), `${c} がありません`);
  }
});

test('商品の選択肢が対応表から作られる', () => {
  const opts = productOptions();
  assert.ok(opts.includes('スーツケースS'));
  assert.ok(opts.includes('ハンディファン(首振り)'));
  assert.ok(opts.includes('未分類'));
  assert.equal(new Set(opts).size, opts.length);
});

test('重複防止キーは日付そのもの（1日1レコード）', () => {
  assert.equal(dedupKey('2026-07-31'), '2026-07-31');
});

test('レコードを1行=1商品に開ける', () => {
  const rows = flattenDetail({
    report_date: { value: '2026-07-30' },
    detail: {
      value: [
        { value: { s_channel: { value: 'Amazon' }, s_product: { value: 'スーツケースM' }, s_qty: { value: '2' }, s_amount: { value: '59600' }, s_confidence: { value: '確定' } } },
      ],
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 59600);
  assert.equal(rows[0].confidence, '確定');
});

test('★紐づけ要確認の売上を見えるようにするグラフがある', () => {
  const r = REPORTS['紐づけ要確認（今月）'];
  assert.ok(r, '要確認を見るグラフがありません');
  assert.match(r.filterCond, /要確認/);
});

test('棒・縦棒グラフには chartMode と sorts がある', () => {
  for (const [name, r] of Object.entries(REPORTS)) {
    if (['BAR', 'COLUMN', 'LINE'].includes(r.chartType)) {
      assert.ok(r.chartMode, `${name} に chartMode がありません`);
    }
    assert.ok(r.sorts, `${name} に sorts がありません`);
  }
});

test('一覧の絞り込みが kintone の日付関数を使っている', () => {
  assert.equal(VIEWS['今日'].filterCond, 'report_date = TODAY()');
  assert.equal(VIEWS['今月'].filterCond, 'report_date = THIS_MONTH()');
});
