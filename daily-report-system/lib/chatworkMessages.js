// ============================================================
//  Chatwork のメッセージ（議事録など）を取得する
// ------------------------------------------------------------
//  GET /rooms/{room_id}/messages?force=1 で最新100件を取得します。
//  【朝礼/月初会議報告所】のような議事録ルームの本文を集めて、
//  そこからタスクを抽出する（lib/taskExtract.js）ために使います。
//
//  ※ Chatwork は読むだけ。メッセージは変更しません。
// ============================================================
import { required } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

const API_BASE = 'https://api.chatwork.com/v2';

function headers() {
  return { 'X-ChatWorkToken': required('CHATWORK_API_TOKEN') };
}

/**
 * ルームの最新メッセージを取得（最大100件）。
 * @param {string|number} roomId
 * @param {object} opts { force=true }  true で既読も含め最新100件
 * @returns {Promise<Array>} [{message_id, account, body, send_time, ...}]
 */
export async function fetchRoomMessages(roomId, opts = {}) {
  const force = opts.force === false ? 0 : 1;
  const res = await fetchWithRetry(
    `${API_BASE}/rooms/${encodeURIComponent(roomId)}/messages?force=${force}`,
    { headers: headers() },
    { label: `chatwork messages ${roomId}` }
  );
  // メッセージが無いと 204（json は空）になる
  return Array.isArray(res.json) ? res.json : [];
}

/**
 * メッセージ配列を、抽出に渡す1つのテキストにまとめる。
 * ・新しい順に、指定文字数の上限まで詰める（トークン節約）。
 * ・Chatworkの装飾タグ [To:...] [rp ...] [info]...[/info] などは軽く除去。
 * @param {Array} messages
 * @param {object} opts { maxChars=16000, sinceUnix }
 * @returns {string}
 */
export function messagesToText(messages, opts = {}) {
  const maxChars = opts.maxChars || 16000;
  const sinceUnix = opts.sinceUnix || 0;

  const sorted = [...messages].sort((a, b) => Number(b.send_time || 0) - Number(a.send_time || 0));
  const parts = [];
  let total = 0;
  for (const m of sorted) {
    if (sinceUnix && Number(m.send_time || 0) < sinceUnix) continue;
    const body = cleanBody(m.body || '');
    if (!body) continue;
    const when = m.send_time ? new Date(Number(m.send_time) * 1000).toISOString().slice(0, 10) : '';
    const who = (m.account && m.account.name) || '';
    const block = `--- ${when} ${who} ---\n${body}`;
    if (total + block.length > maxChars) break;
    parts.push(block);
    total += block.length;
  }
  // 古い順に戻す（読みやすさ）
  return parts.reverse().join('\n\n');
}

// Chatworkの装飾タグをテキスト向けに軽く除去
export function cleanBody(body) {
  return String(body)
    .replace(/\[rp[^\]]*\]/gi, '')
    .replace(/\[To:[^\]]*\]/gi, '')
    .replace(/\[qt\]|\[\/qt\]/gi, '')
    .replace(/\[qtmeta[^\]]*\]/gi, '')
    .replace(/\[picon:[^\]]*\]/gi, '')
    .replace(/\[title\]|\[\/title\]/gi, '')
    .replace(/\[info\]|\[\/info\]/gi, '')
    .replace(/\[hr\]/gi, '\n')
    .trim();
}
