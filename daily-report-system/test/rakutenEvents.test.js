// ============================================================
//  参謀レポートの「楽天イベントカレンダー」のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・カレンダーが無い日でもレポートが壊れないこと（従来どおり）
//    ・単発／期間イベントが正しくその日に該当すること
//    ・8月定例MTGの打ち手（マラソン・FSF締切）が実ファイルから読めること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsForDate, loadEvents, formatBrief, computeBrief } from '../scripts/dailyBrief.js';

function rec(dateISO, amount) {
  return {
    report_date: { value: dateISO },
    detail: { value: [{ value: { s_channel: { value: '楽天' }, s_product: { value: 'テスト' }, s_amount: { value: String(amount) }, s_qty: { value: '1' } } }] },
  };
}

const CAL = {
  events: [
    { label: '🛒 マラソン', from: '2026-08-04', to: '2026-08-11', time: '20:00〜' },
    { label: '⏰ 締切', from: '2026-08-12' },
  ],
};

test('期間イベントは両端を含めて該当日に出る', () => {
  assert.deepEqual(eventsForDate(CAL, '2026-08-03'), []);
  assert.deepEqual(eventsForDate(CAL, '2026-08-04'), ['🛒 マラソン（20:00〜）']);
  assert.deepEqual(eventsForDate(CAL, '2026-08-08'), ['🛒 マラソン（20:00〜）']);
  assert.deepEqual(eventsForDate(CAL, '2026-08-11'), ['🛒 マラソン（20:00〜）']);
  assert.deepEqual(eventsForDate(CAL, '2026-08-12'), ['⏰ 締切']);
});

test('カレンダーが無い/空でも壊れない', () => {
  assert.deepEqual(eventsForDate(null, '2026-08-04'), []);
  assert.deepEqual(eventsForDate({}, '2026-08-04'), []);
  assert.equal(loadEvents('2031-01-01'), null);
});

test('イベントが無ければ従来どおり「イベント・メモ」1行', () => {
  const b = computeBrief([rec('2026-08-01', 1000)], '2026-08-01', null);
  const text = formatBrief(b, '2026-08-01', null, null, []);
  assert.ok(text.includes('■ イベント・メモ'));
  assert.ok(!text.includes('本日の楽天イベント'));
});

test('イベントがあればレポートに一覧が入る', () => {
  const b = computeBrief([rec('2026-08-04', 1000)], '2026-08-04', null);
  const text = formatBrief(b, '2026-08-04', null, null, ['🛒 マラソン（20:00〜）']);
  assert.ok(text.includes('■ 本日の楽天イベント'));
  assert.ok(text.includes('🛒 マラソン'));
  assert.ok(text.includes('■ メモ（キントーン）'));
});

test('2026年の実ファイルが読めてMTGの打ち手が該当する', () => {
  const cal = loadEvents('2026-08-06');
  assert.ok(cal, 'config/rakuten-events-2026.json があること');
  // マラソン期間中（8/4〜8/11）
  assert.ok(eventsForDate(cal, '2026-08-06').some((s) => s.includes('マラソン')));
  // FSF準備の締切（8/12）
  assert.ok(eventsForDate(cal, '2026-08-12').some((s) => s.includes('締切')));
  // FSF本番（8/24〜8/27）
  assert.ok(eventsForDate(cal, '2026-08-25').some((s) => s.includes('Fashion Special Fair')));
});
