// ============================================================
//  在庫管理アプリのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・Amazon倉庫 と CS在庫 を合算しない
//    ・「合計では在庫があるのに、その販路では売れない」を見逃さない
//    ・欠品・残りわずかの判定を間違えない
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STOCK_SLOTS, FIELDS, dedupKey, slotStatus, flattenDetail, productOptions,
} from '../kintone/inventorySchema.js';
import { VIEWS, REPORTS } from '../kintone/inventoryViews.js';
import { analyzeStock, formatStockReport, LOW_STOCK } from '../lib/stock.js';

/** テスト用のレコードを作る */
function rec(dateISO, rows) {
  return {
    snapshot_date: { value: dateISO },
    detail: {
      value: rows.map(([product, amazon, cs]) => ({
        value: {
          i_product: { value: product },
          i_amazon: { value: String(amazon) },
          i_cs: { value: String(cs) },
        },
      })),
    },
  };
}

test('在庫ファイルの置き場は Amazon と CS の2つ', () => {
  assert.equal(STOCK_SLOTS.length, 2);
  assert.equal(FIELDS.f_stock_amazon.type, 'FILE');
  assert.equal(FIELDS.f_stock_cs.type, 'FILE');
  // 事務所を含むことがラベルから分かること
  assert.match(FIELDS.f_stock_cs.label, /事務所/);
});

test('★Amazon在庫とCS在庫は別の欄で持つ（合算しない）', () => {
  const sub = FIELDS.detail.fields;
  assert.equal(sub.i_amazon.type, 'NUMBER');
  assert.equal(sub.i_cs.type, 'NUMBER');
  // 合計は計算式で出す（手入力させない）
  assert.equal(sub.i_total.type, 'CALC');
  assert.equal(sub.i_total.expression, 'i_amazon + i_cs');
});

test('商品の選択肢が対応表から作られ、重複しない', () => {
  const opts = productOptions();
  assert.ok(opts.includes('スーツケースS'));
  assert.ok(opts.includes('ハンディファン(首振り)'));
  assert.equal(new Set(opts).size, opts.length);
});

test('重複防止キーは基準日そのもの（1日1レコード）', () => {
  assert.equal(dedupKey('2026-07-31'), '2026-07-31');
});

test('明細を1行=1商品の形に開ける', () => {
  const rows = flattenDetail(rec('2026-07-31', [['スーツケースS', 10, 20]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amazon, 10);
  assert.equal(rows[0].cs, 20);
  assert.equal(rows[0].total, 30);
  assert.equal(rows[0].date, '2026-07-31');
});

test('空のレコードでも落ちない', () => {
  assert.deepEqual(flattenDetail({}), []);
  assert.deepEqual(flattenDetail(null), []);
  const a = analyzeStock(null);
  assert.equal(a.totals.all, 0);
  assert.doesNotThrow(() => formatStockReport(a));
});

test('★Amazon倉庫が空でCSに在庫がある商品を見つける（FBA補充の機会）', () => {
  const a = analyzeStock(rec('2026-07-31', [['スーツケースS', 0, 110]]));
  assert.equal(a.needFbaRestock.length, 1);
  assert.equal(a.needFbaRestock[0].product, 'スーツケースS');
  // 合計では110個あるので、欠品にも残りわずかにもならない
  assert.equal(a.out.length, 0);
  assert.equal(a.few.length, 0);
  assert.match(formatStockReport(a), /Amazon倉庫が空です/);
});

test('★CS在庫が空でAmazonに在庫がある商品を見つける（楽天・自社が出せない）', () => {
  const a = analyzeStock(rec('2026-07-31', [['ハンディファン(スケルトン)', 28, 0]]));
  assert.equal(a.needCsRestock.length, 1);
  assert.equal(a.out.length, 0);
  assert.match(formatStockReport(a), /楽天・自社の注文が出せません/);
});

test('両方0のときだけ欠品にする', () => {
  const a = analyzeStock(rec('2026-07-31', [['クラシックアルミ', 0, 0], ['スーツケースS', 0, 5]]));
  assert.equal(a.out.length, 1);
  assert.equal(a.out[0].product, 'クラシックアルミ');
});

test('残りわずかのしきい値（既定10個・変更できる）', () => {
  const r = rec('2026-07-31', [['ミニハンディファン', 3, 4]]);
  assert.equal(LOW_STOCK, 10);
  assert.equal(analyzeStock(r).few.length, 1); // 7個 → 残りわずか
  assert.equal(analyzeStock(r, null, { low: 5 }).few.length, 0); // 基準を5にすると対象外
});

test('前回と比べて大きく減った商品を出す', () => {
  const prev = rec('2026-07-30', [['スーツケースS', 60, 100]]);
  const now = rec('2026-07-31', [['スーツケースS', 10, 30]]);
  const a = analyzeStock(now, prev);
  assert.equal(a.drops.length, 1);
  assert.equal(a.drops[0].prevTotal, 160);
  assert.equal(a.drops[0].total, 40);
  assert.match(formatStockReport(a), /前回より大きく減った商品/);
});

test('前回が無くても落ちない（初日）', () => {
  const a = analyzeStock(rec('2026-07-31', [['スーツケースS', 10, 20]]), null);
  assert.equal(a.drops.length, 0);
  assert.doesNotThrow(() => formatStockReport(a));
});

test('増えた商品は「減った」に入れない', () => {
  const prev = rec('2026-07-30', [['スーツケースS', 10, 10]]);
  const now = rec('2026-07-31', [['スーツケースS', 50, 50]]);
  assert.equal(analyzeStock(now, prev).drops.length, 0);
});

test('問題が無ければ、そう書く', () => {
  const text = formatStockReport(analyzeStock(rec('2026-07-31', [['スーツケースS', 100, 100]])));
  assert.match(text, /欠品・残りわずかの商品はありません/);
});

test('★棒・折れ線グラフには chartMode と sorts が必須', () => {
  for (const [name, r] of Object.entries(REPORTS)) {
    if (['BAR', 'COLUMN', 'LINE'].includes(r.chartType)) {
      assert.ok(r.chartMode, `${name} に chartMode がありません`);
    }
    assert.ok(r.sorts, `${name} に sorts がありません`);
  }
});

test('一覧の絞り込みが kintone の日付関数を使っている', () => {
  assert.equal(VIEWS['今日'].filterCond, 'snapshot_date = TODAY()');
  assert.equal(VIEWS['今週'].filterCond, 'snapshot_date = THIS_WEEK()');
  assert.equal(VIEWS['今月'].filterCond, 'snapshot_date = THIS_MONTH()');
});

test('一覧に、倉庫別の合計と添付欄が出る', () => {
  for (const c of ['total_amazon', 'total_cs', 'f_stock_amazon', 'f_stock_cs']) {
    assert.ok(VIEWS['今日'].fields.includes(c), `${c} が一覧に出ません`);
  }
});
