// Kintone REST API の最小クライアント（サーバー専用）。
// 認証はアプリ用APIトークン（推奨）か、無ければ連携用アカウントのID/パスワード。
// 認証情報はすべて環境変数から読む。値をログに出さない。
//
//  KINTONE_BASE_URL         例: https://xxxx.cybozu.com
//  KINTONE_TASK_APP_ID      タスク管理（チーム進捗）アプリ番号（既定 38）
//  KINTONE_API_TOKEN_TASK   上記アプリのAPIトークン（レコード閲覧・追加・編集）
//  KINTONE_USER / KINTONE_PASSWORD  トークンが無いときのフォールバック

export type KintoneValue = { value: unknown };
export type KintoneRecord = Record<string, KintoneValue>;

export class KintoneError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'KintoneError';
    this.status = status;
    this.code = code;
  }
}

function baseUrl(): string | null {
  const raw = (process.env.KINTONE_BASE_URL || '').trim().replace(/\/$/, '');
  return raw ? raw : null;
}

function authHeaders(token: string | undefined): Record<string, string> | null {
  if (token) return { 'X-Cybozu-API-Token': token };
  const user = (process.env.KINTONE_USER || '').trim();
  const pass = process.env.KINTONE_PASSWORD || '';
  if (user && pass) {
    return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
  }
  return null;
}

/** タスク管理アプリの接続設定が揃っているか（値は返さない） */
export function kintoneTaskConfigured(): boolean {
  return Boolean(baseUrl() && authHeaders((process.env.KINTONE_API_TOKEN_TASK || '').trim()));
}

export function kintoneTaskAppId(): string {
  return (process.env.KINTONE_TASK_APP_ID || '38').trim();
}

const TIMEOUT_MS = 10_000;

/**
 * 汎用リクエスト。GET には Content-Type を付けない（付けると kintone が 400 を返す）。
 */
export async function kintoneApi<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  apiPath: string,
  body?: unknown,
  token = (process.env.KINTONE_API_TOKEN_TASK || '').trim(),
): Promise<T> {
  const base = baseUrl();
  const auth = authHeaders(token);
  if (!base || !auth) throw new KintoneError('Kintone の接続設定がありません', 0, 'NOT_CONFIGURED');

  const headers: Record<string, string> = { ...auth };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${apiPath}`, {
      method,
      headers,
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const msg = typeof json.message === 'string' ? json.message : `HTTP ${res.status}`;
      throw new KintoneError(msg, res.status, typeof json.code === 'string' ? json.code : undefined);
    }
    return json as T;
  } catch (e) {
    if (e instanceof KintoneError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new KintoneError('Kintone への接続がタイムアウトしました（10秒）', 0, 'TIMEOUT');
    }
    throw new KintoneError(e instanceof Error ? e.message : String(e), 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** 全レコードを $id カーソルで取得（1ページ500件） */
export async function fetchAllRecords(app: string, condition = ''): Promise<KintoneRecord[]> {
  const all: KintoneRecord[] = [];
  let lastId = 0;
  for (let guard = 0; guard < 40; guard++) {
    const where = [condition, `$id > ${lastId}`].filter(Boolean).join(' and ');
    const query = `${where} order by $id asc limit 500`;
    const res = await kintoneApi<{ records: KintoneRecord[] }>(
      'GET',
      `/k/v1/records.json?${qs({ app, query })}`,
    );
    const records = res.records ?? [];
    if (!records.length) break;
    all.push(...records);
    lastId = Number((records[records.length - 1].$id as KintoneValue).value);
    if (records.length < 500) break;
  }
  return all;
}

export async function addRecord(app: string, record: Record<string, { value: string }>) {
  return kintoneApi<{ id: string; revision: string }>('POST', '/k/v1/record.json', { app, record });
}

export async function updateRecord(
  app: string,
  id: string,
  record: Record<string, { value: string }>,
) {
  return kintoneApi<{ revision: string }>('PUT', '/k/v1/record.json', { app, id, record });
}

/** ドロップダウンの選択肢をアプリの設定から取得（順序付き） */
export async function fetchDropdownOptions(app: string, codes: string[]): Promise<Record<string, string[]>> {
  const res = await kintoneApi<{
    properties: Record<string, { type: string; options?: Record<string, { label: string; index: string }> }>;
  }>('GET', `/k/v1/app/form/fields.json?${qs({ app })}`);
  const out: Record<string, string[]> = {};
  for (const code of codes) {
    const prop = res.properties?.[code];
    if (prop?.options) {
      out[code] = Object.values(prop.options)
        .sort((a, b) => Number(a.index) - Number(b.index))
        .map((o) => o.label);
    }
  }
  return out;
}
