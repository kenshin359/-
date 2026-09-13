// ============================================================
//  韓国SNS運用管理のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・事前共有「撮影日の2日前まで」のルールが必ず判定される
//    ・撮影後 / 投稿後 / 成果 の報告が抜けたら必ず気づける
//    ・kintoneの選択肢と設定ファイル（config/korea-sns.json）がズレない
//    ・一覧・グラフが存在しないフィールドを指していない（作成時エラー防止）
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FIELDS, VIEWS, REPORTS, MEDIA_OPTIONS, FORMAT_OPTIONS, POST_TYPE_OPTIONS, GOAL_OPTIONS, STATUS_OPTIONS,
} from '../kintone/koreaSnsSchema.js';
import {
  normalizeRecord, checkRecord, summarize, formatKoreaSnsReport,
  leadDays, daysBetween, lastPostDate, weekRange, monthRange, hasBlocker,
} from '../lib/koreaSns.js';

const CFG = JSON.parse(readFileSync(new URL('../config/korea-sns.json', import.meta.url), 'utf8'));
const RULES = CFG.rules;

// ── テスト用のレコードづくり（kintone形式） ───────────────
function rec(over = {}, posts = []) {
  const base = {
    $id: '1',
    title: '9/20 明洞店 インフルエンサー撮影',
    status: '① 事前共有済み',
    owner: 'ミンジ',
    editor: 'ソンチャン',
    goal: '予約獲得',
    shared_at: '2026-09-17',
    shoot_date: '2026-09-20',
    shoot_time: '14:00〜17:00',
    place: '明洞本店',
    content: '来店から施術までの流れ',
    cast: '@myeongdong_kim',
    cast_follower: 52000,
    plan_count: 3,
    plan_media: ['Instagram', 'TikTok'],
    plan_post_date: '2026-09-25',
    plan_ad: 'あり',
    shot_count: null,
    edit_count: null,
    edit_due: null,
    edit_done: null,
    inflow: null,
    reserve: null,
    visit: null,
    sales: null,
    result_note: null,
  };
  const merged = { ...base, ...over };
  const out = {};
  for (const [k, v] of Object.entries(merged)) out[k] = { value: v === null ? '' : v };
  out.posts = {
    value: posts.map((p) => ({
      id: '1',
      value: Object.fromEntries(
        Object.entries({
          p_post_date: null, p_media: null, p_format: null, p_type: null, p_url: null,
          p_ad: 'なし', p_ad_cost: null, p_views: null, p_likes: null, p_saves: null,
          p_profile: null, p_clicks: null, p_note: null, ...p,
        }).map(([k, v]) => [k, { value: v === null ? '' : v }])
      ),
    })),
  };
  return out;
}

const norm = (...args) => normalizeRecord(rec(...args));
const codes = (alerts) => alerts.map((a) => a.code);

// ── 設計のズレ防止 ────────────────────────────────
test('kintoneの選択肢と config/korea-sns.json が一致している', () => {
  assert.deepEqual(MEDIA_OPTIONS, CFG.media);
  assert.deepEqual(FORMAT_OPTIONS, CFG.formats);
  assert.deepEqual(POST_TYPE_OPTIONS, CFG.post_types);
  assert.deepEqual(GOAL_OPTIONS, CFG.goals);
});

test('進捗は 撮影→編集→投稿→広告→成果 の順に並んでいる', () => {
  // 「投稿して終わり」にしないため、成果集計が最後に入っていること
  assert.ok(STATUS_OPTIONS.includes('④ 投稿済み'));
  assert.ok(STATUS_OPTIONS.includes('⑥ 成果集計済み'));
  assert.ok(STATUS_OPTIONS.indexOf('⑥ 成果集計済み') > STATUS_OPTIONS.indexOf('④ 投稿済み'));
});

test('一覧・グラフが存在しないフィールドを指していない', () => {
  const top = new Set(Object.keys(FIELDS));
  const sub = new Set(Object.keys(FIELDS.posts.fields));
  for (const view of Object.values(VIEWS)) {
    for (const f of view.fields) assert.ok(top.has(f), `一覧「${view.name}」の ${f} が定義にありません`);
  }
  for (const [key, r] of Object.entries(REPORTS)) {
    assert.equal(key, r.name, 'REPORTSのキーは name と完全一致させること');
    for (const g of r.groups ?? []) {
      assert.ok(top.has(g.code) || sub.has(g.code), `グラフ「${r.name}」の ${g.code} が定義にありません`);
    }
    for (const a of r.aggregations ?? []) {
      if (a.code) assert.ok(top.has(a.code) || sub.has(a.code), `グラフ「${r.name}」の ${a.code} が定義にありません`);
    }
  }
});

test('サブテーブルのフィールドコードが重複していない', () => {
  const sub = Object.keys(FIELDS.posts.fields);
  assert.equal(new Set(sub).size, sub.length);
  for (const [code, f] of Object.entries(FIELDS.posts.fields)) assert.equal(f.code, code);
});

// ── 読み取り ──────────────────────────────────
test('kintoneレコードを読み取れる（投稿はサブテーブルから）', () => {
  const r = norm({}, [{ p_post_date: '2026-09-25', p_media: 'Instagram', p_views: 12000, p_ad: 'あり', p_ad_cost: 30000 }]);
  assert.equal(r.title, '9/20 明洞店 インフルエンサー撮影');
  assert.deepEqual(r.planMedia, ['Instagram', 'TikTok']);
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].views, 12000);
  assert.equal(r.posts[0].ad, true);
  assert.equal(r.shotCount, null, '未入力は null（0と区別する）');
});

test('日付の計算', () => {
  assert.equal(daysBetween('2026-09-17', '2026-09-20'), 3);
  assert.equal(daysBetween('2026-09-20', '2026-09-17'), -3);
  assert.equal(daysBetween(null, '2026-09-20'), null);
  assert.equal(leadDays(norm()), 3);
  assert.equal(lastPostDate(norm({}, [{ p_post_date: '2026-09-25' }, { p_post_date: '2026-09-28' }])), '2026-09-28');
});

// ── ② 事前共有は撮影日の2日前まで ────────────────────
test('★3日前の共有はOK、1日前と未共有はアラート', () => {
  const ok = checkRecord(norm({ shared_at: '2026-09-17' }), { today: '2026-09-18', rules: RULES });
  assert.ok(!codes(ok).includes('late_advance_notice'));
  assert.ok(!codes(ok).includes('no_advance_notice'));

  const late = checkRecord(norm({ shared_at: '2026-09-19' }), { today: '2026-09-19', rules: RULES });
  assert.ok(codes(late).includes('late_advance_notice'));
  assert.match(late.find((a) => a.code === 'late_advance_notice').message, /1日前/);

  const none = checkRecord(norm({ shared_at: null }), { today: '2026-09-18', rules: RULES });
  assert.ok(codes(none).includes('no_advance_notice'));
  assert.equal(none.find((a) => a.code === 'no_advance_notice').level, '🔴');
});

test('撮影後に共有された場合も「遅い」と分かる文言になる', () => {
  const a = checkRecord(norm({ shared_at: '2026-09-22' }), { today: '2026-09-22', rules: RULES });
  assert.match(a.find((x) => x.code === 'late_advance_notice').message, /撮影2日後/);
});

test('事前報告の欄が抜けていれば、抜けた項目名を挙げる', () => {
  const a = checkRecord(norm({ place: null, cast: null, plan_ad: '未定' }), { today: '2026-09-18', rules: RULES });
  const m = a.find((x) => x.code === 'incomplete_advance_notice').message;
  for (const w of ['撮影場所', '出演者', '広告利用の有無']) assert.ok(m.includes(w), `${w} が挙がっていません`);
});

// ── ③ 撮影後報告 ────────────────────────────────
test('撮影日を過ぎても本数の報告がなければアラート（翌日以降は🔴）', () => {
  const next = checkRecord(norm(), { today: '2026-09-21', rules: RULES });
  assert.ok(codes(next).includes('shoot_report_due'));

  const late = checkRecord(norm(), { today: '2026-09-23', rules: RULES });
  const hit = late.find((a) => a.code === 'no_shoot_report');
  assert.ok(hit && hit.level === '🔴');
});

test('撮影本数だけ入れて編集完了予定日が無ければ指摘する', () => {
  const a = checkRecord(norm({ shot_count: 3 }), { today: '2026-09-21', rules: RULES });
  assert.ok(codes(a).includes('no_edit_due'));
});

// ── ④ 編集・投稿の遅れ ───────────────────────────
test('編集完了予定日を過ぎたら🔴（担当者名つき）', () => {
  const a = checkRecord(norm({ shot_count: 3, edit_count: 3, edit_due: '2026-09-24' }), { today: '2026-09-27', rules: RULES });
  const hit = a.find((x) => x.code === 'edit_overdue');
  assert.ok(hit && hit.level === '🔴');
  assert.match(hit.message, /3日遅れ/);
  assert.match(hit.message, /ソンチャン/);
});

test('編集が完了していれば遅れ扱いにしない', () => {
  const a = checkRecord(norm({ shot_count: 3, edit_due: '2026-09-24', edit_done: '2026-09-24' }), { today: '2026-09-27', rules: RULES });
  assert.ok(!codes(a).includes('edit_overdue'));
});

test('投稿予定日を過ぎても投稿の記録が無ければ🔴', () => {
  const a = checkRecord(norm({ shot_count: 3, edit_due: '2026-09-24', edit_done: '2026-09-24' }), { today: '2026-09-28', rules: RULES });
  const hit = a.find((x) => x.code === 'post_overdue');
  assert.ok(hit && hit.level === '🔴');
});

// ── ⑤ 投稿後報告 ────────────────────────────────
test('投稿URL・媒体・形態・広告費の抜けを指摘する', () => {
  const r = norm({ shot_count: 1, edit_done: '2026-09-24', status: '④ 投稿済み' }, [
    { p_post_date: '2026-09-25', p_media: 'Instagram', p_format: 'リール', p_type: '通常投稿', p_ad: 'あり' },
  ]);
  const a = checkRecord(r, { today: '2026-09-26', rules: RULES });
  assert.ok(codes(a).includes('no_post_url'));
  assert.ok(codes(a).includes('no_ad_cost'));

  const full = norm({ shot_count: 1, edit_done: '2026-09-24', status: '④ 投稿済み' }, [
    {
      p_post_date: '2026-09-25', p_media: 'Instagram', p_format: 'リール', p_type: 'タイアップ（PR表記あり）',
      p_url: 'https://www.instagram.com/reel/xxxx/', p_ad: 'あり', p_ad_cost: 30000,
    },
  ]);
  const b = checkRecord(full, { today: '2026-09-26', rules: RULES });
  for (const c of ['no_post_url', 'no_post_kind', 'no_ad_cost']) assert.ok(!codes(b).includes(c));
});

// ── ⑥ 予約・成果まで追う ─────────────────────────
test('★投稿から7日たっても流入・予約が未入力なら🔴', () => {
  const posts = [{
    p_post_date: '2026-09-25', p_media: 'Instagram', p_format: 'リール', p_type: '通常投稿',
    p_url: 'https://example.com/p/1', p_views: 12000,
  }];
  const base = { shot_count: 1, edit_count: 1, edit_due: '2026-09-24', edit_done: '2026-09-24', status: '④ 投稿済み' };

  const soon = checkRecord(norm(base, posts), { today: '2026-09-30', rules: RULES });
  assert.ok(!codes(soon).includes('no_result'), '7日以内はまだ催促しない');

  const late = checkRecord(norm(base, posts), { today: '2026-10-05', rules: RULES });
  const hit = late.find((a) => a.code === 'no_result');
  assert.ok(hit && hit.level === '🔴');

  const done = checkRecord(norm({ ...base, inflow: 320, reserve: 12 }, posts), { today: '2026-10-05', rules: RULES });
  assert.ok(!codes(done).includes('no_result'));
});

test('中止した案件は催促しない', () => {
  assert.deepEqual(checkRecord(norm({ status: '中止', shared_at: null }), { today: '2026-10-05', rules: RULES }), []);
});

// ── 集計 ────────────────────────────────────
test('撮影→投稿→広告→流入→予約 を合計し、予約単価を出す', () => {
  const a = norm(
    { shot_count: 3, edit_count: 3, inflow: 320, reserve: 12, visit: 9, sales: 540000 },
    [
      { p_post_date: '2026-09-25', p_media: 'Instagram', p_views: 12000, p_clicks: 300, p_ad: 'あり', p_ad_cost: 60000 },
      { p_post_date: '2026-09-26', p_media: 'TikTok', p_views: 40000, p_clicks: 500 },
    ]
  );
  const b = norm({ $id: '2', shot_count: 2, edit_count: 2, reserve: 3, sales: 120000 }, [
    { p_post_date: '2026-09-28', p_media: 'Instagram', p_views: 8000 },
  ]);

  const s = summarize([a, b], {
    today: '2026-09-30', rules: RULES, targets: CFG.targets, from: '2026-09-01', to: '2026-09-30',
  });

  assert.equal(s.totals.shoots, 2);
  assert.equal(s.totals.shotCount, 5);
  assert.equal(s.totals.posts, 3);
  assert.equal(s.totals.views, 60000);
  assert.equal(s.totals.adCost, 60000);
  assert.equal(s.totals.reserve, 15);
  assert.equal(s.totals.sales, 660000);
  assert.equal(s.cpa, 4000, '広告費60,000 ÷ 予約15件');
  assert.equal(s.cpaOver, false);
  assert.equal(s.byMedia.Instagram.posts, 2);
  assert.equal(s.byMedia.TikTok.views, 40000);
});

test('期間外の案件は集計に入らない', () => {
  const old = normalizeRecord(rec({ shoot_date: '2026-08-10', plan_post_date: '2026-08-15' }));
  const s = summarize([old], { today: '2026-09-30', rules: RULES, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(s.totals.shoots, 0);
  assert.equal(s.alerts.length, 0);
});

test('予約が0件なら予約単価は出さない（0除算しない）', () => {
  const r = normalizeRecord(rec({}, [{ p_post_date: '2026-09-25', p_ad: 'あり', p_ad_cost: 50000 }]));
  const s = summarize([r], { today: '2026-09-26', rules: RULES, targets: CFG.targets });
  assert.equal(s.cpa, null);
});

test('目標CPAを超えたら超過として印がつく', () => {
  const r = normalizeRecord(rec({ reserve: 1 }, [{ p_post_date: '2026-09-25', p_ad: 'あり', p_ad_cost: 50000 }]));
  const s = summarize([r], { today: '2026-09-26', rules: RULES, targets: { cpa_yen: 8000 } });
  assert.equal(s.cpa, 50000);
  assert.equal(s.cpaOver, true);
});

// ── レポート本文 ─────────────────────────────
test('レポートに 要対応・数字・媒体別・進捗 が出る', () => {
  const r = normalizeRecord(rec({ shared_at: null, shot_count: 2, reserve: 4 }, [
    { p_post_date: '2026-09-25', p_media: 'Instagram', p_format: 'リール', p_type: '通常投稿', p_url: 'https://e.com/1', p_views: 9000, p_ad: 'あり', p_ad_cost: 12000 },
  ]));
  const s = summarize([r], { today: '2026-09-26', rules: RULES, targets: CFG.targets, from: '2026-09-01', to: '2026-09-30' });
  const text = formatKoreaSnsReport(s, { title: '韓国SNS 週次まとめ（明洞）' });

  assert.match(text, /韓国SNS 週次まとめ（明洞）/);
  assert.match(text, /2026-09-01 〜 2026-09-30/);
  assert.match(text, /要対応/);
  assert.match(text, /事前共有の記録がありません/);
  assert.match(text, /流入 .* → 予約 4/);
  assert.match(text, /Instagram: 1本/);
  assert.match(text, /■ 進捗/);
  assert.equal(hasBlocker(s), true);
});

test('抜けが無ければ「要対応: なし」と出る', () => {
  const r = normalizeRecord(rec(
    { shot_count: 3, edit_count: 3, edit_due: '2026-09-24', edit_done: '2026-09-24', inflow: 300, reserve: 10, visit: 8, sales: 400000, status: '⑥ 成果集計済み' },
    [{ p_post_date: '2026-09-25', p_media: 'Instagram', p_format: 'リール', p_type: '通常投稿', p_url: 'https://e.com/1', p_views: 9000, p_ad: 'あり', p_ad_cost: 12000 }]
  ));
  const s = summarize([r], { today: '2026-09-26', rules: RULES, targets: CFG.targets });
  assert.match(formatKoreaSnsReport(s), /要対応: なし/);
  assert.equal(hasBlocker(s), false);
});

// ── 期間 ────────────────────────────────────
test('週は月曜はじまり・日曜おわり', () => {
  assert.deepEqual(weekRange('2026-09-13'), ['2026-09-07', '2026-09-13']); // 日曜
  assert.deepEqual(weekRange('2026-09-14'), ['2026-09-14', '2026-09-20']); // 月曜
});

test('月の範囲（うるう年も）', () => {
  assert.deepEqual(monthRange('2026-09'), ['2026-09-01', '2026-09-30']);
  assert.deepEqual(monthRange('2024-02'), ['2024-02-01', '2024-02-29']);
});
