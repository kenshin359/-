// ============================================================
//  通知の送り先をまとめて扱う（LINE / Chatwork）
// ------------------------------------------------------------
//  呼び出し側は「送りたい本文」を渡すだけでよく、
//  どのサービスに送るかは設定（.env）で決まります。
//
//  【設定】NOTIFY_CHANNELS
//    line      … LINEだけに送る
//    chatwork  … Chatworkだけに送る
//    both      … 両方に送る
//    auto      … 設定されているものすべてに送る（既定）
//
//  auto の場合、トークンが入っているサービスにだけ送ります。
//  例：Chatworkのトークンだけ設定 → Chatworkにだけ届く。
//
//  片方が失敗しても、もう片方の送信は続行します
//  （通知が完全に届かなくなる事態を避けるため）。
// ============================================================
import { optional } from './env.js';
import { pushLine } from './line.js';
import { pushChatwork } from './chatwork.js';

/** 設定と実際のトークン有無から、送信先を決める */
export function resolveChannels() {
  const mode = (optional('NOTIFY_CHANNELS', 'auto') || 'auto').toLowerCase();

  const hasLine =
    !!optional('LINE_CHANNEL_ACCESS_TOKEN') &&
    (!!optional('LINE_TARGET_GROUP_ID') || !!optional('LINE_TARGET_USER_ID'));
  const hasChatwork = !!optional('CHATWORK_API_TOKEN') && !!optional('CHATWORK_ROOM_ID');

  if (mode === 'line') return ['line'];
  if (mode === 'chatwork') return ['chatwork'];
  if (mode === 'both') return ['line', 'chatwork'];

  // auto: 設定が揃っているものだけ
  const channels = [];
  if (hasLine) channels.push('line');
  if (hasChatwork) channels.push('chatwork');
  return channels;
}

/**
 * 設定された全ての宛先へ通知する。
 *
 * @param {string} text  本文
 * @param {object} opts  { urgent: 緊急か（Chatworkで全員宛てにするか判断） }
 * @returns {Promise<{results: Array, anySent: boolean, allFailed: boolean}>}
 */
export async function notify(text, opts = {}) {
  const channels = resolveChannels();

  if (!channels.length) {
    console.warn(
      '⚠️ 通知先が未設定です。LINE か Chatwork のどちらかを .env に設定してください。\n' +
        '   LINE     : LINE_CHANNEL_ACCESS_TOKEN と LINE_TARGET_GROUP_ID（または USER_ID）\n' +
        '   Chatwork : CHATWORK_API_TOKEN と CHATWORK_ROOM_ID'
    );
    return { results: [], anySent: false, allFailed: true };
  }

  const results = [];
  for (const ch of channels) {
    try {
      if (ch === 'line') {
        const r = await pushLine(text);
        results.push({ channel: 'line', ok: true, ...r });
      } else {
        // 緊急時のみ Chatwork で全員宛てにする（既定ON。うるさければ .env で切る）
        const mentionAll =
          !!opts.urgent && optional('CHATWORK_MENTION_ALL_ON_URGENT', 'true') !== 'false';
        const r = await pushChatwork(text, { mentionAll });
        results.push({ channel: 'chatwork', ok: true, ...r });
      }
    } catch (e) {
      // 片方が落ちても、もう片方は送る
      console.error(`  ❌ ${ch} への送信に失敗: ${e.message}`);
      results.push({ channel: ch, ok: false, error: e.message });
    }
  }

  // skipped（テストモード）は「失敗」ではない
  const anySent = results.some((r) => r.ok);
  return { results, anySent, allFailed: !anySent };
}

/** 通知結果を1行で説明する（ログ表示用） */
export function describeResults(results) {
  if (!results.length) return '通知先なし';
  return results
    .map((r) => {
      if (!r.ok) return `${r.channel}:失敗`;
      if (r.skipped) return `${r.channel}:テスト(未送信)`;
      return `${r.channel}:送信成功`;
    })
    .join(' / ');
}
