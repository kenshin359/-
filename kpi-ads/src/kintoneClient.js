// kintone REST API クライアント（KPIアプリ書き込み用）
// 認証情報はすべて環境変数から読み込む（コードには一切書かない）。
// この自動化はレコードの読み書きのみ行うため APIトークン認証を使う。

function subdomain() {
  const s = process.env.KINTONE_SUBDOMAIN;
  if (!s) throw new Error('KINTONE_SUBDOMAIN が未設定です（例: w6pq7i12hn4b）');
  return s;
}

function base() {
  return `https://${subdomain()}.cybozu.com`;
}

// KPIアプリ専用の APIトークン。既存ツールとトークンを分けておくと安全。
function authHeaders() {
  const token = process.env.KINTONE_KPI_API_TOKEN;
  if (!token) {
    throw new Error('KINTONE_KPI_API_TOKEN が未設定です（KPIアプリの設定→APIトークンで発行し、read/write 権限を付与）。');
  }
  return { 'X-Cybozu-API-Token': token };
}

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
