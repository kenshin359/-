// ============================================================
//  売上管理シート送信メッセージのテスト
// ------------------------------------------------------------
//  数字はすべて架空のダミーです（実データは使いません）。
// ============================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessage } from '../scripts/sendSalesSheet.js';

function day(date, rakuten, amazon, own, units = {}) {
  return {
    date,
    sales: { rakuten, amazon, own, total: rakuten + amazon + own },
    units,
    unitsTotal: Object.values(units).reduce((a, b) => a + b, 0),
    access: { rakuten: null, amazon: null },
    cvr: { rakuten: null, amazon: null },
    favorites: null,
    stayTime: null,
    hasUnits: Object.keys(units).length > 0,
  };
}

const DATA = {
  generatedAt: '2026-07-29T00:00:00.000Z',
  source: 'テスト',
  period: { from: '2026-06-01', to: '2026-07-02' },
  daily: [
    // 6月: 2日で合計 300万 → 日商平均 150万
    day('2026-06-01', 1000000, 0, 0, { rakuten: 10 }),
    day('2026-06-02', 2000000, 0, 0, { rakuten: 20 }),
    // 7月: 2日で合計 900万 → 日商平均 450万（+200%）
    day('2026-07-01', 2000000, 1000000, 500000, { rakuten: 30, amazon: 5 }),
    day('2026-07-02', 3000000, 2000000, 500000, { rakuten: 40, amazon: 5 }),
  ],
  products: [
    { name: '商品A', group: 'ファン', units: { rakuten: { '2026-07-01': 30, '2026-07-02': 40 } }, cvr: {}, rank: {} },
    { name: '商品B', group: 'その他', units: { amazon: { '2026-07-01': 5, '2026-07-02': 5 } }, cvr: {}, rank: {} },
  ],
  issues: ['テスト用の指摘'],
};

describe('送信メッセージ', () => {
  const msg = buildMessage(DATA);

  test('期間合計は全チャネルの総和', () => {
    // 100万 + 200万 + 350万 + 550万 = 1,200万
    assert.match(msg, /期間合計　¥12,000,000/);
  });

  test('日数を明記する', () => {
    assert.match(msg, /4日分/);
  });

  test('チャネル別の構成比を出す', () => {
    // 楽天 800万 / 1200万 = 66.7%
    assert.match(msg, /楽天　¥8,000,000　\(66\.7%\)/);
    assert.match(msg, /Amazon　¥3,000,000　\(25\.0%\)/);
    assert.match(msg, /自社サイト　¥1,000,000　\(8\.3%\)/);
  });

  test('月比較は累計ではなく日商平均で行う', () => {
    assert.match(msg, /6月　¥1,500,000\/日　（2日分）/);
    assert.match(msg, /7月　¥4,500,000\/日　（2日分）/);
    assert.match(msg, /前月比　\+200\.0%/);
  });

  test('売れ筋は期間合計の個数で並べる', () => {
    assert.match(msg, /1\. 商品A　70個/);
    assert.match(msg, /2\. 商品B　10個/);
  });

  test('販売個数の合計を出す', () => {
    // 10 + 20 + 35 + 45 = 110
    assert.match(msg, /販売個数　110個/);
  });

  test('データの指摘を隠さず載せる', () => {
    assert.match(msg, /【要確認】/);
    assert.match(msg, /テスト用の指摘/);
  });

  test('シートの中身を説明する', () => {
    for (const s of ['日次サマリー', '商品別サマリー', '商品×日 個数', '月次サマリー']) {
      assert.ok(msg.includes(s), `${s} の説明がない`);
    }
  });

  test('Chatworkの1メッセージ上限（4000字）に収まる', () => {
    assert.ok(msg.length < 4000, `長すぎる: ${msg.length}字`);
  });

  test('月が1つしか無ければ前月比を出さない', () => {
    const one = { ...DATA, daily: DATA.daily.slice(2) };
    assert.ok(!buildMessage(one).includes('前月比'));
  });

  test('指摘が無ければ要確認欄を出さない', () => {
    assert.ok(!buildMessage({ ...DATA, issues: [] }).includes('要確認'));
  });

  test('売上が0でも割り算で壊れない', () => {
    const zero = {
      ...DATA,
      daily: [day('2026-07-01', 0, 0, 0)],
      products: [],
      issues: [],
    };
    assert.doesNotThrow(() => buildMessage(zero));
    assert.match(buildMessage(zero), /楽天　¥0　\(0\.0%\)/);
  });
});
