// kintone REST API クライアント
// パスワード認証（X-Cybozu-Authorization）と APIトークン認証（X-Cybozu-API-Token）の両対応。
// 認証情報はすべて環境変数から読み込む（コードには一切書かない）。

function subdomain() {
  const s = process.env.KINTONE_SUBDOMAIN;
  if (!s) throw new Error('KINTONE_SUBDOMAIN が未設定です（例: w6pq7i12hn4b）');
  return s;
}

function base() {
  return `https://${subdomain()}.cybozu.com`;
}

// 認証ヘッダーを組み立てる。
// - パスワードがあればパスワード認証（アプリ作成など管理系に必須）
// - なければ APIトークン認証（レコードの読み書き用）
function authHeaders() {
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  const token = process.env.KINTONE_API_TOKEN;

  if (user && pass) {
    const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
    return { 'X-Cybozu-Authorization': encoded };
  }
  if (token) {
    return { 'X-Cybozu-API-Token': token };
  }
  throw new Error(
    '認証情報がありません。KINTONE_USER + KINTONE_PASSWORD、または KINTONE_API_TOKEN を .env に設定してください。'
  );
}

// kintone API を呼ぶ共通関数。
// GET はクエリ文字列を path に含めて渡す（body は使わない）。
export async function kintone(method, path, body) {
  const url = `${base()}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  };
  if (body !== undefined && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`kintone API ${res.status}: ${json?.message || res.statusText}`);
    err.status = res.status;
    err.detail = json;
    throw err;
  }
  return json;
}

// GET 用のクエリ文字列を安全に組み立てるヘルパー
export function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}
