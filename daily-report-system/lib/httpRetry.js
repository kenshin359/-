// ============================================================
//  リトライ付き fetch ラッパー
// ------------------------------------------------------------
//  - ネットワーク障害 / 5xx / 429(レート制限) を指数バックオフで再試行。
//  - 429 に Retry-After ヘッダがあればそれを優先。
//  - 4xx（429以外）は再試行しても無駄なので即エラー（呼び出し側の不備）。
// ============================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch をリトライ付きで実行する。
 * @param {string} url
 * @param {object} options    fetch のオプション
 * @param {object} cfg        { retries=4, baseDelayMs=2000, label='request' }
 * @returns {Promise<{ok, status, json, text, headers}>}
 */
export async function fetchWithRetry(url, options = {}, cfg = {}) {
  const retries = cfg.retries ?? 4;
  const baseDelayMs = cfg.baseDelayMs ?? 2000;
  const label = cfg.label ?? 'request';

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = null; // JSON でない（後段で text を使う）
      }

      // 成功
      if (res.ok) return { ok: true, status: res.status, json, text, headers: res.headers };

      // レート制限 or サーバエラー → リトライ対象
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : baseDelayMs * Math.pow(2, attempt); // 2s, 4s, 8s, 16s
          console.warn(`[${label}] ${res.status} 応答。${wait}ms 待って再試行 (${attempt + 1}/${retries})`);
          await sleep(wait);
          continue;
        }
      }

      // それ以外の 4xx はリトライしても直らない
      const err = new Error(`[${label}] HTTP ${res.status}: ${text?.slice(0, 500)}`);
      err.status = res.status;
      err.body = json ?? text;
      throw err;
    } catch (e) {
      // fetch 自体の失敗（ネットワーク障害など）
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429) throw e; // 4xx は即座に投げ直す
      if (attempt < retries) {
        const wait = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[${label}] 通信エラー: ${e.message}。${wait}ms 待って再試行 (${attempt + 1}/${retries})`);
        await sleep(wait);
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`[${label}] リトライ上限に達しました`);
}
