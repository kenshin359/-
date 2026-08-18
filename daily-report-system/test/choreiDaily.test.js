// ============================================================
//  朝礼台本（choreiDaily）のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・必要日販の計算が正しいこと（月末・達成済みの境界含む）
//    ・「昨日のファイル」だけを広告費として拾うこと
//    ・台本に必要日販と昨日売上が必ず入ること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredDailyPace, matchYesterdayFile, buildScript } from '../scripts/choreiDaily.js';

test('必要日販 = (目標−累計)÷残り日数', () => {
  // 8/9まで実績2,783万・残り22日
  assert.equal(requiredDailyPace(110000000, 27831658, 9, 31), Math.round(82168342 / 22));
  assert.equal(requiredDailyPace(120000000, 27831658, 9, 31), Math.round(92168342 / 22));
});

test('目標達成済みなら0、月末なら null', () => {
  assert.equal(requiredDailyPace(110000000, 120000000, 20, 31), 0);
  assert.equal(requiredDailyPace(110000000, 50000000, 31, 31), null);
});

test('昨日のファイルだけを拾う（表記ゆれ対応・期間まとめは除外）', () => {
  const y = '2026-08-09';
  assert.equal(matchYesterdayFile('8:9 Amazon広告.csv', y), true);
  assert.equal(matchYesterdayFile('8：9 楽天RPP.csv', y), true);
  assert.equal(matchYesterdayFile('Google広告 8月9日.csv', y), true);
  assert.equal(matchYesterdayFile('meta_0809.csv', y), true);
  assert.equal(matchYesterdayFile('8:8 Amazon広告.csv', y), false);
  assert.equal(matchYesterdayFile('8:7〜8:9 Google広告.csv', y), false);
});

test('台本に必要日販・昨日売上・チーム枠が入る', () => {
  const body = buildScript({
    dateISO: '2026-08-10',
    yesterday: '2026-08-09',
    sales: { mtd: 27831658, yday: { 楽天: 1178920, Amazon: 981180 }, ydayOrders: 82, avg7: 3200000 },
    ads: { byMedia: { 'Meta広告': 357237, 'RPP(楽天)': 68607 }, unread: 0 },
    plan: { days: { '2026-08-09': { 楽天: 1827834, Amazon: 955250, 自社サイト: 1216254 } } },
  });
  assert.ok(body.includes('必要日販'));
  assert.ok(body.includes('1.1億ライン'));
  assert.ok(body.includes('楽天 ¥1,178,920'));
  assert.ok(body.includes('82件'));
  assert.ok(body.includes('1️⃣ 広告運用'));
  assert.ok(body.includes('西岡さん'));
});

test('タスクボードのブロックが台本に入る（期限超過・本日期限・完了数）', () => {
  const base = {
    dateISO: '2026-08-19',
    yesterday: '2026-08-18',
    sales: { yday: { 楽天: 1000 }, ydayOrders: 1, mtd: 1000, avg7: 1000 },
    ads: { byMedia: {}, unread: 0 },
    plan: null,
  };
  const tasks = {
    overdue: [{ tantou: '黒葛原', name: 'ピクセル設置確認', due: '2026-08-18' }],
    todayDue: [{ tantou: '北野', name: 'SP-API担当指名', due: '2026-08-19' }],
    doneCount: 2,
  };
  const body = buildScript({ ...base, tasks });
  assert.match(body, /期限超過 1件/);
  assert.match(body, /ピクセル設置確認（黒葛原・08\/18期限）/);
  assert.match(body, /本日期限：SP-API担当指名（北野）/);
  assert.match(body, /昨日完了：2件/);
});

test('タスクアプリ未設定（tasks=null）なら従来どおりの台本', () => {
  const base = {
    dateISO: '2026-08-19',
    yesterday: '2026-08-18',
    sales: { yday: { 楽天: 1000 }, ydayOrders: 1, mtd: 1000, avg7: 1000 },
    ads: { byMedia: {}, unread: 0 },
    plan: null,
    tasks: null,
  };
  const body = buildScript(base);
  assert.doesNotMatch(body, /タスクボード/);
  assert.match(body, /各チーム報告/);
});
