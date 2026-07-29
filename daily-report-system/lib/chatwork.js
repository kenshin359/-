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
 * Chatwork へファイル（日報画像）を本文つきで投稿する。
 *
 * Chatwork のファイル投稿は multipart/form-data。
 * Node 18+ の FormData / Blob をそのまま fetch に渡せる。
 *
 * @param {object} opts { buffer, fileName, contentType, message, roomId }
 * @returns {Promise<{sent:boolean, skipped?:boolean, roomId:string, fileName:string}>}
 */
export async function uploadChatworkFile({ buffer, fileName, contentType, message, roomId }) {
  const room = roomId || optional('CHATWORK_ROOM_ID');
  if (!room) throw new Error('Chatwork の送信先が未設定です（CHATWORK_ROOM_ID）');

  // Chatwork のファイル上限は 5MB。超える場合は本文だけ送る判断を呼び出し側に委ねる。
  const MAX_BYTES = 5 * 1024 * 1024;
  if (buffer.length > MAX_BYTES) {
    throw new Error(`ファイルが大きすぎます（${Math.round(buffer.length / 1024)}KB / 上限5MB）`);
  }

  if (!isProduction()) {
    console.log('── [TEST] Chatwork ファイル送信スキップ（APP_ENV=test）──');
    console.log(`ルーム: ${room} / ${fileName} (${Math.round(buffer.length / 1024)}KB)`);
    if (message) console.log('── 添える本文 ──\n' + message);
    return { sent: false, skipped: true, roomId: room, fileName };
  }

  const token = required('CHATWORK_API_TOKEN');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType || 'image/png' }), fileName);
  // ファイルに添える説明文（4000字上限に合わせて切る）
  if (message) form.append('message', message.slice(0, 4000));

  await fetchWithRetry(
    `${API_BASE}/rooms/${encodeURIComponent(room)}/files`,
    {
      method: 'POST',
      headers: { 'X-ChatWorkToken': token }, // Content-Type は FormData が自動設定
      body: form,
    },
    { label: 'chatwork-file', retries: 3, baseDelayMs: 2000 }
  );

  return { sent: true, roomId: room, fileName };
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
