// ============================================================
//  日次CSV提出ボックスのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・8つの置き場（売上4・広告4）が欠けない
//    ・置き場の設定が、他のアプリ・設定ファイルとズレない
//    ・何が足りないかを正しく数える
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SALES_SLOTS, AD_SLOTS, ALL_SLOTS, FIELDS, dedupKey, slotStatus,
} from '../kintone/intakeSchema.js';
import { VIEWS } from '../kintone/intakeViews.js';
import { formatIntakeCheck } from '../lib/intake.js';
import { MEDIA_OPTIONS } from '../kintone/adCostSchema.js';

test('置き場は 売上4 + 広告4 の8つ', () => {
  assert.equal(SALES_SLOTS.length, 4);
  assert.equal(AD_SLOTS.length, 4);
  assert.equal(ALL_SLOTS.length, 8);
  // 社長のご指定どおりの顔ぶれ
  const labels = ALL_SLOTS.map((s) => s.label).join(' ');
  for (const w of ['Amazon', '楽天', 'Shopify', 'TikTok', 'Meta', 'RPP', 'Google', 'その他']) {
    assert.ok(labels.includes(w), `${w} の置き場がありません`);
  }
});

test('置き場のフィールドコードが重複していない', () => {
  const codes = ALL_SLOTS.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.equal(FIELDS[c]?.type, 'FILE', `${c} がファイル欄になっていません`);
});

test('★広告の置き場は「広告費管理」アプリの媒体名と一致している', () => {
  // ズレると取り込み時に選択肢エラーになり、静かに失敗する
  for (const s of AD_SLOTS) {
    assert.ok(MEDIA_OPTIONS.includes(s.media), `「${s.media}」が広告費管理の選択肢にありません`);
  }
});

test('★売上の置き場は sales-mapping.json のIDと一致している', () => {
  const mapping = JSON.parse(readFileSync(new URL('../config/sales-mapping.json', import.meta.url), 'utf8'));
  const ids = mapping.channels.map((c) => c.id);
  for (const s of SALES_SLOTS) {
    assert.ok(ids.includes(s.channelId), `「${s.channelId}」が sales-mapping.json にありません`);
  }
});

test('重複防止キーは日付そのもの（1日1レコード）', () => {
  assert.equal(dedupKey('2026-07-31'), '2026-07-31');
});

test('ファイルの有無を正しく数える', () => {
  const record = {
    f_sales_amazon: { value: [{ name: 'a.csv', fileKey: 'k1', size: '10' }] },
    f_ad_meta: { value: [{ name: 'm.csv', fileKey: 'k2', size: '20' }, { name: 'm2.csv', fileKey: 'k3', size: '30' }] },
  };
  const slots = slotStatus(record);
  assert.equal(slots.filter((s) => s.filled).length, 2);
  assert.equal(slots.find((s) => s.code === 'f_ad_meta').count, 2);
  assert.equal(slots.find((s) => s.code === 'f_sales_rakuten').filled, false);
});

test('空のレコードでも落ちない', () => {
  const slots = slotStatus({});
  assert.equal(slots.length, 8);
  assert.equal(slots.every((s) => !s.filled), true);
});

test('報告文に、そろっている数と未提出の一覧が入る', () => {
  const slots = slotStatus({ f_sales_amazon: { value: [{ name: 'a.csv', fileKey: 'k', size: '1' }] } });
  const check = {
    date: '2026-07-31', exists: true, recordId: '1', status: '提出中',
    slots, missing: slots.filter((s) => !s.filled), filled: slots.filter((s) => s.filled), allDone: false,
  };
  const text = formatIntakeCheck(check, { weekday: '金' });
  assert.match(text, /そろっている: 1 \/ 8/);
  assert.match(text, /【未提出】/);
  assert.match(text, /売上｜楽天/);
  assert.ok(!text.includes('すべてそろっています'));
});

test('全部そろったら催促しない', () => {
  const value = [{ name: 'x.csv', fileKey: 'k', size: '1' }];
  const record = Object.fromEntries(ALL_SLOTS.map((s) => [s.code, { value }]));
  const slots = slotStatus(record);
  const check = {
    date: '2026-07-31', exists: true, recordId: '1', status: '提出中',
    slots, missing: [], filled: slots, allDone: true,
  };
  const text = formatIntakeCheck(check);
  assert.match(text, /すべてそろっています/);
  assert.ok(!text.includes('【未提出】'));
});

test('レコードが無いときは「作ってください」と伝える', () => {
  const text = formatIntakeCheck({ date: '2026-07-31', exists: false, slots: [], missing: [], filled: [], allDone: false });
  assert.match(text, /レコードがまだ作られていません/);
});

test('一覧の絞り込みが kintone の日付関数を使っている', () => {
  assert.equal(VIEWS['今日'].filterCond, 'report_date = TODAY()');
  assert.equal(VIEWS['今週'].filterCond, 'report_date = THIS_WEEK()');
  // 未取込の一覧に、休業日を含めない
  assert.match(VIEWS['未取込'].filterCond, /対象外\(休業日\)/);
});

test('一覧の列に、8つの置き場がすべて出る', () => {
  for (const s of ALL_SLOTS) {
    assert.ok(VIEWS['今日'].fields.includes(s.code), `${s.label} が一覧に出ません`);
  }
});
