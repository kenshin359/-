// ============================================================
//  通知先の切り替えテスト（LINE / Chatwork）
// ------------------------------------------------------------
//  設定に応じて正しい宛先が選ばれること、
//  Chatwork の装飾・分割が仕様どおりであることを検証する。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChannels, describeResults } from '../lib/notify.js';
import { splitForChatwork, decorate } from '../lib/chatwork.js';

// 各テストの前に通知関連の環境変数を消す
function clearEnv() {
  for (const k of [
    'NOTIFY_CHANNELS', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_TARGET_GROUP_ID',
    'LINE_TARGET_USER_ID', 'CHATWORK_API_TOKEN', 'CHATWORK_ROOM_ID',
  ]) delete process.env[k];
}

test('auto: LINEだけ設定 → LINEのみ', () => {
  clearEnv();
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 't';
  process.env.LINE_TARGET_GROUP_ID = 'g';
  assert.deepEqual(resolveChannels(), ['line']);
});

test('auto: Chatworkだけ設定 → Chatworkのみ', () => {
  clearEnv();
  process.env.CHATWORK_API_TOKEN = 't';
  process.env.CHATWORK_ROOM_ID = '123';
  assert.deepEqual(resolveChannels(), ['chatwork']);
});

test('auto: 両方設定 → 両方に送る', () => {
  clearEnv();
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 't';
  process.env.LINE_TARGET_USER_ID = 'u';
  process.env.CHATWORK_API_TOKEN = 't';
  process.env.CHATWORK_ROOM_ID = '123';
  assert.deepEqual(resolveChannels(), ['line', 'chatwork']);
});

test('auto: 何も設定なし → 送信先なし', () => {
  clearEnv();
  assert.deepEqual(resolveChannels(), []);
});

test('NOTIFY_CHANNELS で明示指定できる', () => {
  clearEnv();
  process.env.CHATWORK_API_TOKEN = 't';
  process.env.CHATWORK_ROOM_ID = '123';
  process.env.NOTIFY_CHANNELS = 'line';   // 設定が無くても明示指定を優先
  assert.deepEqual(resolveChannels(), ['line']);
  process.env.NOTIFY_CHANNELS = 'both';
  assert.deepEqual(resolveChannels(), ['line', 'chatwork']);
});

test('LINEはトークンだけで宛先が無ければ対象外', () => {
  clearEnv();
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 't'; // 宛先IDが無い
  assert.deepEqual(resolveChannels(), []);
});

test('Chatwork: 長文は4000字で分割される', () => {
  const parts = splitForChatwork('あ\n'.repeat(6000)); // 12000字
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(p.length <= 4000);
});

test('Chatwork: 1行目が見出しになる装飾', () => {
  const d = decorate('📝 日報が届きました\n\n久保さん\n【要点】改修5件');
  assert.ok(d.startsWith('[info][title]📝 日報が届きました[/title]'));
  assert.ok(d.endsWith('[/info]'));
  assert.ok(d.includes('【要点】改修5件'));
});

test('Chatwork: 緊急時は全員宛てにできる', () => {
  assert.ok(decorate('🚨 要対応\n本文', { mentionAll: true }).startsWith('[toall]'));
  assert.ok(!decorate('📝 通常\n本文').startsWith('[toall]'));
});

test('describeResults: 結果を1行で説明する', () => {
  assert.equal(
    describeResults([{ channel: 'line', ok: true }, { channel: 'chatwork', ok: false }]),
    'line:送信成功 / chatwork:失敗'
  );
  assert.equal(describeResults([{ channel: 'line', ok: true, skipped: true }]), 'line:テスト(未送信)');
  assert.equal(describeResults([]), '通知先なし');
});

// ── 画像添付の扱い ────────────────────────────────────────
// LINEは公開URLが必要なため画像を送れない（本文のみ）。
// Chatworkはファイル添付APIで画像を送れる。この違いを固定する。
import { uploadChatworkFile } from '../lib/chatwork.js';

test('Chatwork: 5MBを超える画像は明示的にエラーになる', async () => {
  process.env.CHATWORK_ROOM_ID = '1';
  process.env.APP_ENV = 'production';
  process.env.CHATWORK_API_TOKEN = 'dummy';
  await assert.rejects(
    () => uploadChatworkFile({
      buffer: Buffer.alloc(6 * 1024 * 1024),
      fileName: 'big.png',
      contentType: 'image/png',
    }),
    /大きすぎます|5MB/
  );
  delete process.env.APP_ENV;
});

test('Chatwork: テストモードでは画像を送信しない', async () => {
  process.env.CHATWORK_ROOM_ID = '1';
  process.env.APP_ENV = 'test';
  const r = await uploadChatworkFile({
    buffer: Buffer.from('dummy'),
    fileName: 'a.png',
    contentType: 'image/png',
    message: 'テスト',
  });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, true);
});

test('Chatwork: 宛先未設定なら分かりやすいエラー', async () => {
  delete process.env.CHATWORK_ROOM_ID;
  await assert.rejects(
    () => uploadChatworkFile({ buffer: Buffer.from('x'), fileName: 'a.png' }),
    /送信先が未設定/
  );
});
