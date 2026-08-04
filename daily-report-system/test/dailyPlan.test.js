// ============================================================
//  参謀レポートの「日別計画比」のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・計画ファイルが無い月でもレポートが壊れないこと
//    ・当日差額と累計計画比が正しく計算されること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlanCompare, formatBrief, computeBrief, loadDailyPlan } from '../scripts/dailyBrief.js';

function rec(dateISO, amount) {
  return {
    report_date: { value: dateISO },
    detail: { value: [{ value: { s_channel: { value: '楽天' }, s_product: { value: 'テスト' }, s_amount: { value: String(amount) }, s_qty: { value: '1' } } }] },
  };
}

const PLAN = {
  monthly_target: 120000000,
  days: {
    '2026-08-01': { 楽天: 1000000, Amazon: 500000, 自社サイト: 500000 },
    '2026-08-02': { 楽天: 1000000, Amazon: 500000, 自社サイト: 500000 },
  },
};

test('当日差額と累計計画比を計算する', () => {
  const records = [rec('2026-08-01', 2500000), rec('2026-08-02', 1500000)];
  const cmp = computePlanCompare(records, '2026-08-02', PLAN);
  assert.equal(cmp.dayPlan, 2000000);
  assert.equal(cmp.dayDiff, -500000);        // 実績150万 − 計画200万
  assert.equal(cmp.mtdPlan, 4000000);
  assert.equal(cmp.mtdDiff, 0);              // 累計400万 = 計画400万
  assert.equal(cmp.mtdRate, 100);
});

test('計画ファイルが無ければ null（レポートは従来どおり）', () => {
  assert.equal(computePlanCompare([], '2026-08-01', null), null);
  assert.equal(loadDailyPlan('2031-01-01'), null);
  const b = computeBrief([rec('2026-08-01', 1000)], '2026-08-01', null);
  const text = formatBrief(b, '2026-08-01', null, null);
  assert.ok(!text.includes('日別計画'), '計画が無いときは計画行を出さない');
});

test('計画があればレポートに計画行が入る', () => {
  const records = [rec('2026-08-01', 2500000)];
  const b = computeBrief(records, '2026-08-01', 120000000);
  const cmp = computePlanCompare(records, '2026-08-01', PLAN);
  const text = formatBrief(b, '2026-08-01', 120000000, cmp);
  assert.ok(text.includes('日別計画'));
  assert.ok(text.includes('✅'), '計画超過なら✅');
  assert.ok(text.includes('累計計画比'));
});

test('8月の実ファイルが読めて合計が目標に一致する', () => {
  const plan = loadDailyPlan('2026-08-15');
  assert.ok(plan, 'config/daily-plan-2026-08.json があること');
  const total = Object.values(plan.days).reduce(
    (s, chs) => s + Object.values(chs).reduce((a, v) => a + v, 0), 0);
  assert.ok(Math.abs(total - plan.monthly_target) < 100, `日割り合計${total}が月間目標とほぼ一致`);
});
