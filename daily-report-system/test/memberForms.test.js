// ============================================================
//  会員手続き書類（同意書・休会届・退会届）の設定JSONのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・列数がずれる形でJSONを壊さないこと
//    ・法務上わざと入れている表現（免責の限定・契約書面・個人情報）が
//      うっかり消されないこと
//    ・配布前チェック（特定商取引法など）の項目が残っていること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'member-forms.json'), 'utf8'));

test('店舗情報がそろっている', () => {
  for (const key of ['name', 'address', 'tel', 'hours', 'manager']) {
    assert.equal(typeof cfg.store[key], 'string', `store.${key} が文字列でない`);
    assert.ok(cfg.store[key].length > 0, `store.${key} が空`);
  }
});

test('コース表は[コース名,料金,回数・期限]の3要素', () => {
  assert.ok(cfg.plans.length >= 2);
  for (const row of cfg.plans) assert.equal(row.length, 3, `列数がずれている: ${row[0]}`);
  assert.ok(cfg.payment_methods.length >= 2);
});

test('健康状態の申告項目がそろっている', () => {
  assert.ok(cfg.health_items.length >= 8, '健康申告の項目が少なすぎる');
  const joined = cfg.health_items.join('／');
  for (const word of ['医師', '心臓', '妊娠', '薬']) {
    assert.ok(joined.includes(word), `健康申告に「${word}」の項目がない`);
  }
});

test('★免責は「責めに帰すべき事由による場合を除き」に限定されている', () => {
  // 全部免責の書き方は消費者契約法で無効になりうるため、この限定表現は必須
  const safety = cfg.consent_items.find((t) => t.includes('【安全】'));
  assert.ok(safety, '【安全】の条項がない');
  assert.ok(safety.includes('責めに帰すべき事由による場合を除き'),
    '免責の限定表現が消えている（全部免責は無効になりうる）');
  assert.ok(!/一切(の)?責任を負(わ|い)ま?せ?ん/.test(safety), '全部免責の書き方になっている');
});

test('★同意事項に契約書面・クーリングオフ・個人情報の記載がある', () => {
  const all = cfg.consent_items.join('\n');
  assert.ok(cfg.consent_items.length >= 8);
  assert.ok(all.includes('契約書面'), '別紙の契約書面への言及がない');
  assert.ok(all.includes('クーリング・オフ'), 'クーリング・オフの権利への言及がない');
  assert.ok(all.includes('個人情報'), '個人情報の取り扱いの記載がない');
  assert.ok(cfg.photo_consent.includes('任意'), '写真掲載の同意が任意だと書かれていない');
});

test('退会・休会の理由と締切の説明がある', () => {
  assert.ok(cfg.withdraw_reasons.length >= 6);
  assert.ok(cfg.leave_reasons.length >= 4);
  for (const key of ['leave', 'withdraw', 'note']) {
    assert.ok(cfg.deadlines[key].length > 0, `deadlines.${key} が空`);
  }
  for (const key of ['fee', 'max', 'restart']) {
    assert.ok(cfg.leave[key].length > 0, `leave.${key} が空`);
  }
});

test('受付台帳と手続きフローの形がそろっている', () => {
  for (const type of ['入会', '休会', '再開', '退会']) {
    assert.ok(cfg.ledger_types.includes(type), `台帳の種別に「${type}」がない`);
  }
  for (const row of cfg.rules_flow) assert.equal(row.length, 5, `手続きフローの列数: ${row[0]}`);
  const types = cfg.rules_flow.map((r) => r[0]);
  for (const type of cfg.ledger_types) {
    assert.ok(types.includes(type), `手続きフローに「${type}」の行がない`);
  }
});

test('★配布前の法務チェック項目が残っている', () => {
  assert.ok(cfg.legal_notes.length >= 4);
  const all = cfg.legal_notes.join('\n');
  assert.ok(all.includes('特定商取引法'), '特定継続的役務提供の注意が消えている');
  assert.ok(all.includes('要配慮個人情報'), '健康情報の取り扱いの注意が消えている');
  assert.ok(/弁護士|専門家/.test(all), '専門家確認の注意が消えている');
});
