// ============================================================
//  LINE Messaging API クライアント（push message）
// ------------------------------------------------------------
//  - 社長・部長（グループ or 個人）へ push 通知します。
//  - 1メッセージ5000文字・1回5吹き出し の制限に合わせ自動分割。
//  - APP_ENV=test のときは送信せずログ出力のみ（安全）。
// ============================================================
import { required, optional, isProduction } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';

// LINE の1テキストメッセージ上限は5000文字。安全側で 4800 で分割。
const MAX_CHARS = 4800;
// push は1リクエストにつき最大5メッセージ（吹き出し）。
const MAX_BUBBLES = 5;

/**
 * 長文を LINE の制限（文字数・吹き出し数）に合わせて分割する。
 * 段落・改行を尊重して自然な位置で切る。
 * @param {string} text
 * @returns {string[][]} リクエスト単位（最大5吹き出し）の2次元配列
 */
export function splitForLine(text) {
  const bubbles = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHARS) {
      bubbles.push(remaining);
      break;
    }
    // MAX_CHARS 以内で最後の改行位置を探して切る
    let cut = remaining.lastIndexOf('\n', MAX_CHARS);
    if (cut < MAX_CHARS * 0.5) cut = MAX_CHARS; // 改行が近くに無ければ強制カット
    bubbles.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  // 5吹き出しずつのリクエストにまとめる
  const requests = [];
  for (let i = 0; i < bubbles.length; i += MAX_BUBBLES) {
    requests.push(bubbles.slice(i, i + MAX_BUBBLES));
  }
  return requests;
}

/**
 * LINE へ push 送信する。
 * @param {string} text     本文（長ければ自動分割）
 * @param {object} opts     { to?: 明示的な宛先ID }
 * @returns {Promise<{sent: boolean, requests: number, to: string, skipped?: boolean}>}
 */
export async function pushLine(text, opts = {}) {
  // 宛先: 明示指定 > グループ > ユーザー の優先順
  const to =
    opts.to ||
    optional('LINE_TARGET_GROUP_ID') ||
    optional('LINE_TARGET_USER_ID');
  if (!to) throw new Error('LINE の宛先が未設定です（LINE_TARGET_GROUP_ID か LINE_TARGET_USER_ID）');

  const requests = splitForLine(text);

  // テスト環境では実送信しない（誤爆防止）
  if (!isProduction()) {
    console.log('── [TEST] LINE 送信スキップ（APP_ENV=test）──');
    console.log(`宛先: ${to} / ${requests.length} リクエスト / ${requests.flat().length} 吹き出し`);
    console.log('── 本文プレビュー ──\n' + text);
    return { sent: false, skipped: true, requests: requests.length, to };
  }

  const token = required('LINE_CHANNEL_ACCESS_TOKEN');
  for (const bubbleGroup of requests) {
    const messages = bubbleGroup.map((t) => ({ type: 'text', text: t }));
    await fetchWithRetry(
      PUSH_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to, messages }),
      },
      { label: 'line-push', retries: 4, baseDelayMs: 2000 }
    );
  }
  return { sent: true, requests: requests.length, to };
}
