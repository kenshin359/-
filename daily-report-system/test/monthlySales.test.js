// ============================================================
//  月次売上レポートのテスト
// ------------------------------------------------------------
//  ここも金額を扱うので、計算の正しさを厚く検証します。
//  数字はすべて架空のダミーです（実データは使いません）。
// ============================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { extractDailySales, findDateIssues } from '../lib/kintoneSales.js';
import {
  buildMonthlySalesReport,
  formatMonthlySalesReport,
  median,
  previousMonth,
  previousDay,
} from '../lib/monthlySalesReport.js';

/** 実アプリと同じ形の本文を作る */
function body(dateStr, rakuten, amazon, own, total) {
  return (
    `${dateStr}の売上をご報告いたします。\n\n` +
    `【売り上げ】\n楽天：${rakuten.toLocaleString()}円\n` +
    `Amazon：${amazon.toLocaleString()}円\n` +
    `自社サイト：${own.toLocaleString()}円\n` +
    `合計：${total.toLocaleString()}円\n`
  );
}

/** 実アプリと同じ形のレコードを作る（フィールドは日付の降順） */
function record(id, label, days) {
  const rec = {
    $id: { type: '__ID__', value: String(id) },
    文字列__1行_: { type: 'SINGLE_LINE_TEXT', value: label },
  };
  days.forEach((d, i) => {
    rec[`文字列__複数行__${20 + i}`] = { type: 'MULTI_LINE_TEXT', value: d };
  });
  return rec;
}

describe('補助関数', () => {
  test('中央値（奇数・偶数・空）', () => {
    assert.equal(median([1, 3, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), null);
  });

  test('前月（年またぎを含む）', () => {
    assert.equal(previousMonth('2026-07'), '2026-06');
    assert.equal(previousMonth('2026-01'), '2025-12');
  });

  test('前日（月またぎを含む）', () => {
    assert.equal(previousDay('2026-07-29'), '2026-07-28');
    assert.equal(previousDay('2026-07-01'), '2026-06-30');
    assert.equal(previousDay('2026-01-01'), '2025-12-31');
  });
});

describe('Kintone売上アプリの読み取り', () => {
  const records = [
    record(10, '7月売り上げ報告', [
      body('2026/07/03(金)', 300000, 200000, 100000, 600000),
      body('2026/07/02(木)', 200000, 150000, 50000, 400000),
      body('2026/07/01(水)', 100000, 100000, 0, 200000),
    ]),
  ];

  test('本文を1日1件に展開する', () => {
    const rows = extractDailySales(records);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].date, '2026-07-01'); // 日付昇順に整列される
    assert.equal(rows[2].total, 600000);
    assert.equal(rows[2].rakuten, 300000);
  });

  test('合計が読めない本文は売上行にしない', () => {
    const r = [record(11, '補足', ['2026/07/05(日)の補足です。\n\n【詳細数値】\n▪️楽天\n転換率：0.5%\n'])];
    assert.equal(extractDailySales(r).length, 0);
  });

  test('空のフィールドは無視する', () => {
    const rec = record(12, '7月', [body('2026/07/01(水)', 1, 1, 1, 3)]);
    rec['文字列__複数行__99'] = { type: 'MULTI_LINE_TEXT', value: '   ' };
    assert.equal(extractDailySales([rec]).length, 1);
  });
});

describe('データの不備の検出', () => {
  test('同じ日付が複数あれば報告する', () => {
    const rows = extractDailySales([
      record(10, '7月', [
        body('2026/07/02(木)', 1, 1, 1, 500000),
        body('2026/07/02(木)', 1, 1, 1, 300000),
        body('2026/07/01(水)', 1, 1, 1, 200000),
      ]),
    ]);
    const issues = findDateIssues(rows);
    const dup = issues.find((i) => i.type === 'duplicate');
    assert.ok(dup, '重複が検出されていない');
    assert.equal(dup.date, '2026-07-02');
    assert.equal(dup.count, 2);
  });

  test('報告が抜けている日を報告する', () => {
    const rows = extractDailySales([
      record(10, '7月', [
        body('2026/07/04(土)', 1, 1, 1, 400000),
        body('2026/07/01(水)', 1, 1, 1, 100000),
      ]),
    ]);
    const missing = findDateIssues(rows).find((i) => i.type === 'missing');
    assert.ok(missing);
    assert.match(missing.detail, /07-02/);
    assert.match(missing.detail, /07-03/);
  });

  test('問題が無ければ何も報告しない', () => {
    const rows = extractDailySales([
      record(10, '7月', [body('2026/07/02(木)', 1, 1, 1, 2), body('2026/07/01(水)', 1, 1, 1, 1)]),
    ]);
    assert.equal(findDateIssues(rows).length, 0);
  });
});

describe('月次レポートの計算', () => {
  // 7月: 1日100万、2日200万、3日300万 → 累計600万・平均200万
  // 6月: 1日 50万、2日150万         → 累計200万・平均100万
  const rows = extractDailySales([
    record(10, '7月', [
      body('2026/07/03(金)', 1500000, 1000000, 500000, 3000000),
      body('2026/07/02(木)', 1000000, 700000, 300000, 2000000),
      body('2026/07/01(水)', 500000, 300000, 200000, 1000000),
    ]),
    record(9, '6月', [
      body('2026/06/02(火)', 800000, 500000, 200000, 1500000),
      body('2026/06/01(月)', 250000, 200000, 50000, 500000),
    ]),
  ]);

  const rep = buildMonthlySalesReport(rows, '2026-07-04');

  test('総売上は当月の合計', () => {
    assert.equal(rep.totals.total, 6000000);
    assert.equal(rep.dayCount, 3);
  });

  test('媒体別の内訳も合計する', () => {
    assert.equal(rep.totals.rakuten, 3000000);
    assert.equal(rep.totals.amazon, 2000000);
    assert.equal(rep.totals.own, 1000000);
    assert.equal(rep.totals.rakuten + rep.totals.amazon + rep.totals.own, rep.totals.total);
  });

  test('昨日の売上を正しく拾う', () => {
    assert.equal(rep.yesterdayISO, '2026-07-03');
    assert.equal(rep.yesterday.total, 3000000);
  });

  test('前日比 = 昨日 ÷ 一昨日', () => {
    // 300万 vs 200万 → +50%
    assert.equal(rep.dod, 50);
  });

  test('前日比は月をまたいでも計算できる', () => {
    const r = buildMonthlySalesReport(rows, '2026-07-02'); // 昨日=7/1、一昨日=6/30(無し)
    assert.equal(r.yesterday.total, 1000000);
    assert.equal(r.dod, null); // 6/30 が無いので比較不可
  });

  test('前月比は日商平均で出す', () => {
    // 7月平均200万 vs 6月平均100万 → +100%
    assert.equal(rep.momAvg, 100);
    assert.equal(rep.average, 2000000);
    assert.equal(rep.prevAverage, 750000 * 2 - 500000); // 100万
  });

  test('前月が月初から揃っているかを判定する', () => {
    assert.equal(rep.prevMonthCoversFullMonth, true);
    const partial = buildMonthlySalesReport(
      extractDailySales([
        record(10, '7月', [body('2026/07/01(水)', 1, 1, 1, 1000000)]),
        record(9, '6月', [body('2026/06/15(月)', 1, 1, 1, 500000)]), // 月初が無い
      ]),
      '2026-07-02'
    );
    assert.equal(partial.prevMonthCoversFullMonth, false);
  });

  test('前月のデータが無ければ前月比は出さない', () => {
    const r = buildMonthlySalesReport(
      extractDailySales([record(10, '7月', [body('2026/07/01(水)', 1, 1, 1, 100)])]),
      '2026-07-02'
    );
    assert.equal(r.momAvg, null);
  });

  test('昨日の報告がまだ無くても落ちない', () => {
    const r = buildMonthlySalesReport(rows, '2026-07-10');
    assert.equal(r.yesterday, null);
    assert.equal(r.dod, null);
    assert.doesNotThrow(() => formatMonthlySalesReport(r));
    assert.match(formatMonthlySalesReport(r), /登録されていません/);
  });

  test('データが1件も無くても落ちない', () => {
    const r = buildMonthlySalesReport([], '2026-07-29');
    assert.equal(r.totals.total, 0);
    assert.doesNotThrow(() => formatMonthlySalesReport(r));
  });
});

describe('イベント判定（推定）', () => {
  // 平常200万が5日、1日だけ600万
  const days = [
    body('2026/07/06(月)', 1, 1, 1, 2000000),
    body('2026/07/05(日)', 1, 1, 1, 6000000), // 急伸
    body('2026/07/04(土)', 1, 1, 1, 2000000),
    body('2026/07/03(金)', 1, 1, 1, 2000000),
    body('2026/07/02(木)', 1, 1, 1, 2000000),
    body('2026/07/01(水)', 1, 1, 1, 2000000),
  ];
  const rep = buildMonthlySalesReport(extractDailySales([record(10, '7月', days)]), '2026-07-07');

  test('平常の1.5倍を超えた日を拾う', () => {
    assert.equal(rep.spikes.length, 1);
    assert.equal(rep.spikes[0].date, '2026-07-05');
    assert.equal(rep.spikes[0].ratio, 3);
  });

  test('昨日が平常なら「平常の範囲内」と書く', () => {
    assert.equal(rep.yesterdayIsSpike, false);
    assert.match(formatMonthlySalesReport(rep), /平常の範囲内/);
  });

  test('昨日が急伸ならイベントの可能性として書く', () => {
    const r = buildMonthlySalesReport(extractDailySales([record(10, '7月', days)]), '2026-07-06');
    assert.equal(r.yesterdayIsSpike, true);
    assert.match(formatMonthlySalesReport(r), /イベント・施策があった可能性/);
  });

  test('推定であることを必ず明記する', () => {
    assert.match(formatMonthlySalesReport(rep), /推定です/);
  });

  test('日付が重複した日はイベント判定から除外する（回帰テスト）', () => {
    // 2日分が1日に合算されると「急伸」に見えてしまうため除外が必要
    const dup = [
      ...days,
      body('2026/07/06(月)', 1, 1, 1, 5000000), // 7/6 が2件目 → 合算で700万になる
    ];
    const r = buildMonthlySalesReport(extractDailySales([record(10, '7月', dup)]), '2026-07-08');
    assert.ok(
      !r.spikes.some((s) => s.date === '2026-07-06'),
      '重複日がイベント候補に混ざっている'
    );
    assert.equal(r.unreliableDays.length, 1);
    assert.equal(r.unreliableDays[0].date, '2026-07-06');
    assert.match(formatMonthlySalesReport(r), /報告が重複しており/);
  });

  test('重複日も総売上には含める（実際に発生した売上のため）', () => {
    const dup = [...days, body('2026/07/06(月)', 1, 1, 1, 5000000)];
    const r = buildMonthlySalesReport(extractDailySales([record(10, '7月', dup)]), '2026-07-08');
    assert.equal(r.totals.total, 2000000 * 5 + 6000000 + 5000000);
  });
});

describe('文面', () => {
  const rows = extractDailySales([
    record(10, '7月', [
      body('2026/07/02(木)', 1000000, 700000, 300000, 2000000),
      body('2026/07/01(水)', 500000, 300000, 200000, 1000000),
    ]),
    record(9, '6月', [body('2026/06/01(月)', 250000, 200000, 50000, 500000)]),
  ]);
  const rep = buildMonthlySalesReport(rows, '2026-07-03');
  const text = formatMonthlySalesReport(rep);

  test('依頼された5項目がすべて入る', () => {
    for (const h of ['【総売上】', '【昨日の売上】', '【前日比】', '【前月比】', '【イベントの有無】']) {
      assert.ok(text.includes(h), `${h} がない`);
    }
  });

  test('金額が3桁区切りで入る', () => {
    assert.match(text, /¥3,000,000/); // 7月累計
    assert.match(text, /¥2,000,000/); // 昨日
  });

  test('データの不備は文面末尾に載せる', () => {
    const issues = [{ type: 'duplicate', date: '2026-07-02', count: 2, detail: 'テスト用の指摘' }];
    assert.match(formatMonthlySalesReport(rep, { issues }), /要確認/);
    assert.match(formatMonthlySalesReport(rep, { issues }), /テスト用の指摘/);
  });

  test('AIコメントは指定した時だけ入る', () => {
    assert.ok(!text.includes('💡'));
    assert.match(formatMonthlySalesReport(rep, { comment: 'テスト' }), /💡 テスト/);
    assert.ok(!formatMonthlySalesReport(rep, { comment: '特記事項なし' }).includes('💡'));
  });
});
