// ============================================================
//  Kintone REST API クライアント
// ------------------------------------------------------------
//  認証は2通りに対応（初心者はパスワード認証だけで動きます）：
//
//   ① APIトークン認証（推奨・最小権限）
//      アプリごとに発行したトークンを使う。権限を細かく絞れて安全。
//      → KINTONE_API_TOKEN_DAILY_REPORT / KINTONE_API_TOKEN_AI_REPORT
//
//   ② パスワード認証（かんたん・トークン発行が不要）
//      ID/パスワードで全操作をまかなう。設定が1回で済むが権限は広い。
//      → KINTONE_USER / KINTONE_PASSWORD
//      ※ 社長個人のアカウントではなく「連携用アカウント」の作成を推奨。
//
//  トークンがあればトークンを優先し、無ければパスワードにフォールバックします。
//  認証情報はすべて環境変数から読み込みます（コードには書きません）。
// ============================================================
import { required, optional } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

function baseUrl() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

/**
 * 使用する認証ヘッダーを決める。
 * @param {string|null} token アプリ用APIトークン（無ければ null）
 * @returns {object} リクエストヘッダー
 */
export function authHeadersFor(token) {
  // ① APIトークンがあればそれを使う（最小権限）
  if (token) return { 'X-Cybozu-API-Token': token };

  // ② 無ければパスワード認証にフォールバック
  const user = optional('KINTONE_USER');
  const pass = optional('KINTONE_PASSWORD');
  if (user && pass) {
    return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
  }

  throw new Error(
    'Kintoneの認証情報がありません。\n' +
      '  かんたん設定: KINTONE_USER と KINTONE_PASSWORD を .env に設定\n' +
      '  または: KINTONE_API_TOKEN_DAILY_REPORT / KINTONE_API_TOKEN_AI_REPORT を設定\n' +
      '  → 分からなければ `npm run setup` を実行してください。'
  );
}

// 汎用リクエスト。token が null ならパスワード認証で実行される。
async function api(method, apiPath, token, body) {
  const url = `${baseUrl()}${apiPath}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeadersFor(token),
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
 * 日報アプリの全レコードを取得する（$id カーソルで全件ページング）。
 *
 * リベティの日報アプリは「1レコード＝1チームの数日分」で、日付は
 * サブテーブルの中に入っている。そのため kintone のクエリでは
 * 日付で絞り込めない。全件取ってから lib/extractReports.js で
 * 日付・氏名・本文に展開し、コード側で対象日を絞る方式にしている。
 *
 * @returns {Promise<Array>} レコード配列（kintone 形式）
 */
export async function fetchAllDailyReportRecords() {
  const app = required('KINTONE_DAILY_REPORT_APP_ID');
  const token = optional('KINTONE_API_TOKEN_DAILY_REPORT') || null; // 無ければパスワード認証

  const all = [];
  let lastId = 0;
  for (;;) {
    const query = `$id > ${lastId} order by $id asc limit 100`;
    const res = await api('GET', `/k/v1/records.json?${qs({ app, query })}`, token);
    const records = res.records ?? [];
    if (!records.length) break;
    all.push(...records);
    lastId = Number(records[records.length - 1].$id.value);
    if (records.length < 100) break;
  }
  return all;
}

/**
 * 指定日の提出済みレコードを取得する（構造化された日報アプリ向け）。
 * report_date / submit_status フィールドを持つアプリでのみ使用可能。
 * ※ 現在のリベティの日報アプリはこの形ではないため、通常は
 *   fetchAllDailyReportRecords + extractReports を使うこと。
 *
 * @param {string} dateISO  'YYYY-MM-DD'
 * @returns {Promise<Array>} レコード配列（kintone 形式）
 */
export async function fetchDailyReports(dateISO) {
  const app = required('KINTONE_DAILY_REPORT_APP_ID');
  const token = optional('KINTONE_API_TOKEN_DAILY_REPORT') || null; // 無ければパスワード認証
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
  const token = optional('KINTONE_API_TOKEN_AI_REPORT') || null; // 無ければパスワード認証
  return api('POST', '/k/v1/record.json', token, { app, record });
}

/**
 * AI経営日報アプリのレコードを更新する（LINE送信結果の書き戻しなど）。
 */
export async function updateAiReport(id, record) {
  const app = required('KINTONE_AI_REPORT_APP_ID');
  const token = optional('KINTONE_API_TOKEN_AI_REPORT') || null; // 無ければパスワード認証
  return api('PUT', '/k/v1/record.json', token, { app, id, record });
}

/**
 * 対象日のAI経営日報がすでに存在するか調べる（重複送信防止）。
 * @returns {Promise<object|null>} 既存レコード or null
 */
export async function findAiReportByDate(dateISO) {
  const app = required('KINTONE_AI_REPORT_APP_ID');
  const token = optional('KINTONE_API_TOKEN_AI_REPORT') || null; // 無ければパスワード認証
  const query = `target_date = "${dateISO}" limit 1`;
  const res = await api('GET', `/k/v1/records.json?${qs({ app, query })}`, token);
  return res.records?.[0] ?? null;
}
