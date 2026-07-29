// ============================================================
//  Kintone の添付ファイル（日報画像）をダウンロードする
// ------------------------------------------------------------
//  日報は画像として添付されているため、Claude に読ませるには
//  ファイル本体を取得して base64 に変換する必要があります。
//
//  ※ 読み取りのみ。Kintone は一切変更しません。
// ============================================================
import { required, optional } from './env.js';
import { authHeadersFor } from './kintone.js';

function baseUrl() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fileKey を指定して添付ファイルを取得し、base64 で返す。
 *
 * 共通の fetchWithRetry はレスポンスを文字列化するため、画像などの
 * バイナリには使えない。ここでは arrayBuffer で受けるリトライを自前で行う。
 *
 * @param {string} fileKey
 * @returns {Promise<{base64: string, bytes: number}>}
 */
export async function downloadFileAsBase64(fileKey) {
  const token = optional('KINTONE_API_TOKEN_DAILY_REPORT') || null;
  const url = `${baseUrl()}/k/v1/file.json?fileKey=${encodeURIComponent(fileKey)}`;
  const headers = { ...authHeadersFor(token) };

  let lastErr;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { base64: buf.toString('base64'), bytes: buf.length };
      }
      // 4xx（429以外）は再試行しても直らない
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`添付ファイルの取得に失敗: HTTP ${res.status}`);
      }
      lastErr = new Error(`添付ファイルの取得に失敗: HTTP ${res.status}`);
    } catch (e) {
      if (/HTTP 4\d\d/.test(e.message) && !/429/.test(e.message)) throw e;
      lastErr = e;
    }
    if (attempt < 3) await sleep(2000 * Math.pow(2, attempt)); // 2s,4s,8s
  }
  throw lastErr ?? new Error('添付ファイルの取得に失敗しました');
}

/** contentType から Claude に渡す media_type を決める */
export function toMediaType(contentType) {
  const t = String(contentType || '').toLowerCase();
  if (t.includes('png')) return 'image/png';
  if (t.includes('webp')) return 'image/webp';
  if (t.includes('gif')) return 'image/gif';
  return 'image/jpeg';
}
