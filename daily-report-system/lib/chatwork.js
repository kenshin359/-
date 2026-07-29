// ============================================================
//  Chatwork API クライアント（メッセージ送信）
// ------------------------------------------------------------
//  指定したルームへメッセージを投稿します。
//  LINE と同じく、APP_ENV=test のときは送信せずログ出力のみ（安全）。
//
//  【必要な設定】
//   CHATWORK_API_TOKEN … Chatwork の「サービス連携」→「API Token」で発行
//   CHATWORK_ROOM_ID   … 通知したいルームのID
//                        （ルームを開いたURL末尾の数字 #!rid123456789 の 123456789）
// ============================================================
import { required, optional, isProduction } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

const API_BASE = 'https://api.chatwork.com/v2';

// Chatwork の1メッセージの実用上限。安全側で 4000 文字で分割する。
const MAX_CHARS = 4000;

/**
 * 長文を Chatwork 向けに分割する（改行位置を尊重）。
 * @param {string} text
 * @returns {string[]}
 */
export function splitForChatwork(text) {
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHARS) {
      parts.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf('\n', MAX_CHARS);
    if (cut < MAX_CHARS * 0.5) cut = MAX_CHARS; // 改行が近くに無ければ強制カット
    parts.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  return parts;
}

/**
 * Chatwork の装飾タグで見やすく整える。
 * [info][title]見出し[/title]本文[/info] が枠付きカードとして表示される。
 *
 * @param {string} text     本文（1行目を見出しとして扱う）
 * @param {object} opts     { mentionAll: 緊急時に全員宛てにするか }
 * @returns {string}
 */
export function decorate(text, opts = {}) {
  const lines = text.split('\n');
  const title = lines[0] ?? '';
  const body = lines.slice(1).join('\n').trim();
  const mention = opts.mentionAll ? '[toall]\n' : '';
  return `${mention}[info][title]${title}[/title]${body}[/info]`;
}

/**
 * Chatwork へメッセージを送信する。
 * @param {string} text  本文（長ければ自動分割）
 * @param {object} opts  { roomId?, mentionAll?, decorate? }
 * @returns {Promise<{sent:boolean, skipped?:boolean, parts:number, roomId:string}>}
 */
export async function pushChatwork(text, opts = {}) {
  const roomId = opts.roomId || optional('CHATWORK_ROOM_ID');
  if (!roomId) throw new Error('Chatwork の送信先が未設定です（CHATWORK_ROOM_ID）');

  // 装飾は既定でON（見やすくするため）。opts.decorate === false で素のテキストになる。
  const shouldDecorate = opts.decorate !== false;
  const parts = splitForChatwork(text);

  // テスト環境では実送信しない（誤爆防止）
  if (!isProduction()) {
    console.log('── [TEST] Chatwork 送信スキップ（APP_ENV=test）──');
    console.log(`ルーム: ${roomId} / ${parts.length} 通`);
    console.log('── 本文プレビュー ──\n' + text);
    return { sent: false, skipped: true, parts: parts.length, roomId };
  }

  const token = required('CHATWORK_API_TOKEN');

  for (let i = 0; i < parts.length; i++) {
    // 分割時は最初の1通だけ装飾とメンションを付ける（2通目以降は続きなので素のまま）
    const body = shouldDecorate && i === 0 ? decorate(parts[i], opts) : parts[i];
    await fetchWithRetry(
      `${API_BASE}/rooms/${encodeURIComponent(roomId)}/messages`,
      {
        method: 'POST',
        headers: {
          'X-ChatWorkToken': token,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        // Chatwork は JSON ではなく form 形式
        body: new URLSearchParams({ body, self_unread: '0' }).toString(),
      },
      { label: 'chatwork', retries: 4, baseDelayMs: 2000 }
    );
  }

  return { sent: true, parts: parts.length, roomId };
}
