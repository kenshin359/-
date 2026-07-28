// ============================================================
//  Kintone REST API クライアント（APIトークン認証）
// ------------------------------------------------------------
//  - スタッフ日報アプリ（読み取り）とAI経営日報アプリ（書き込み）で
//    それぞれ別のトークンを使う設計。
//  - すべての認証情報は環境変数から読み込みます（コードに書かない）。
// ============================================================
import { required } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

function baseUrl() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

// 汎用リクエスト。token はアプリごとのAPIトークン。
async function api(method, apiPath, token, body) {
  const url = `${baseUrl()}${apiPath}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Cybozu-API-Token': token,
    },
  };
  if (body !== undefined && method !== 'GET') options.body = JSON.stringify(body);

  const res = await fetchWithRetry(url, options, { label: `kintone ${method} ${apiPath}` });
  return res.json ?? {};
}

// GET クエリ文字列を安全に組み立てる
export function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * スタッフ日報アプリから、指定日の提出済みレコードを取得する。
 * @param {string} dateISO  'YYYY-MM-DD'
 * @returns {Promise<Array>} レコード配列（kintone 形式）
 */
export async function fetchDailyReports(dateISO) {
  const app = required('KINTONE_DAILY_REPORT_APP_ID');
  const token = required('KINTONE_API_TOKEN_DAILY_REPORT');
  // report_date が対象日 かつ 提出状況 が「提出済み」のレコードだけを対象にする
  const query = `report_date = "${dateISO}" and submit_status in ("提出済み") order by dept asc limit 500`;
  const path = `/k/v1/records.json?${qs({ app, query })}`;
  const res = await api('GET', path, token);
  return res.records ?? [];
}

/**
 * AI経営日報アプリへ1レコード追加する。
 * @param {object} record  kintone のフィールド形式 { field_code: { value } }
 * @returns {Promise<{id, revision}>}
 */
export async function createAiReport(record) {
  const app = required('KINTONE_AI_REPORT_APP_ID');
  const token = required('KINTONE_API_TOKEN_AI_REPORT');
  return api('POST', '/k/v1/record.json', token, { app, record });
}

/**
 * AI経営日報アプリのレコードを更新する（LINE送信結果の書き戻しなど）。
 */
export async function updateAiReport(id, record) {
  const app = required('KINTONE_AI_REPORT_APP_ID');
  const token = required('KINTONE_API_TOKEN_AI_REPORT');
  return api('PUT', '/k/v1/record.json', token, { app, id, record });
}

/**
 * 対象日のAI経営日報がすでに存在するか調べる（重複送信防止）。
 * @returns {Promise<object|null>} 既存レコード or null
 */
export async function findAiReportByDate(dateISO) {
  const app = required('KINTONE_AI_REPORT_APP_ID');
  const token = required('KINTONE_API_TOKEN_AI_REPORT');
  const query = `target_date = "${dateISO}" limit 1`;
  const res = await api('GET', `/k/v1/records.json?${qs({ app, query })}`, token);
  return res.records?.[0] ?? null;
}
