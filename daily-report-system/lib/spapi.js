// ============================================================
//  Amazon SP-API（Selling Partner API）から売上レポートを取る
// ------------------------------------------------------------
//  CSVのダウンロードも、手作業も要りません。
//  Amazonの「注文レポート」を毎朝こちらから取りに行きます。
//
//  ★流れ（Amazonのレポートは「注文して→待って→受け取る」形です）
//    ① レポート作成を依頼する（createReport）
//    ② できあがるまで待つ（15秒ごとに確認、最大10分）
//    ③ できたファイルをダウンロードして解凍する
//
//  ★取るのは自社の注文データだけ。購入者の個人情報は含まれない
//    レポート（GENERAL）を使います。
//
//  ★金額の考え方
//    レポートの item-price は「その行の合計金額（税込・送料含まず）」。
//    Shopify・楽天と同じ「税込・送料抜き」で揃います。
// ============================================================
import { gunzipSync } from 'node:zlib';
import { optional, required } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

/** 日本のマーケットプレイスID（Amazon.co.jp） */
export const MARKETPLACE_JP = 'A1VC38T7YXB528';

/** 日本を含む極東リージョンのAPIサーバー */
const ENDPOINT = 'https://sellingpartnerapi-fe.amazon.com';

/** 個人情報を含まない、注文日ベースの全注文レポート */
export const ORDERS_REPORT_TYPE = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedToken = null;

/**
 * アクセストークンを取る（リフレッシュトークンから毎回引き換える）。
 * 1時間有効なので、実行中は使い回す。
 */
export async function lwaAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  // ★コピペ時に紛れ込みがちな空白・改行はここで取り除く
  const refreshToken = required('SPAPI_REFRESH_TOKEN').trim();
  const clientId = required('SPAPI_CLIENT_ID').trim();
  const clientSecret = required('SPAPI_CLIENT_SECRET').trim();

  // 値そのものは出さずに、形だけ確かめられるようにする（原因の切り分け用）
  if (!clientId.startsWith('amzn1.application-oa2-client.')) {
    console.warn(
      `  ⚠ SPAPI_CLIENT_ID の形が想定と違います（amzn1.application-oa2-client.… で始まるはず。現在: 長さ${clientId.length}）`
    );
  }
  if (!refreshToken.startsWith('Atzr|')) {
    console.warn(`  ⚠ SPAPI_REFRESH_TOKEN の形が想定と違います（Atzr| で始まるはず。現在: 長さ${refreshToken.length}）`);
  }

  let res;
  try {
    res = await fetchWithRetry(
      'https://api.amazon.com/auth/o2/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      },
      { label: 'amazon-lwa', retries: 3 }
    );
  } catch (e) {
    const kind = e.body?.error;
    if (kind === 'invalid_client') {
      e.message =
        'Amazonが「クライアントIDとシークレットのペアが違う」と言っています（invalid_client）。\n' +
        `  ・SPAPI_CLIENT_ID（長さ${clientId.length}）と SPAPI_CLIENT_SECRET（長さ${clientSecret.length}）が\n` +
        '    同じアプリ（本番）の「LWA認証情報」画面から取ったものか確認してください。\n' +
        '  ・直しても失敗する場合は、その画面の「資格情報のローテーション」で新しいシークレットを発行し、\n' +
        '    表示された新しい値を SPAPI_CLIENT_SECRET に登録し直してください。';
    } else if (kind === 'invalid_grant') {
      e.message =
        'Amazonが「リフレッシュトークンが無効」と言っています（invalid_grant）。\n' +
        '  「認可の管理」→「アプリを承認」でトークンを作り直し、SPAPI_REFRESH_TOKEN を上書きしてください。';
    }
    throw e;
  }
  const token = res.json?.access_token;
  if (!token) throw new Error('Amazonのアクセストークンを取得できませんでした');
  cachedToken = { token, expiresAt: Date.now() + (res.json.expires_in ?? 3600) * 1000 };
  return token;
}

/** SP-API を1回呼ぶ（JSONのやりとり用） */
async function call(method, path, body) {
  const token = await lwaAccessToken();
  const res = await fetchWithRetry(
    `${ENDPOINT}${path}`,
    {
      method,
      headers: {
        'x-amz-access-token': token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    { label: `spapi ${method} ${path.split('?')[0]}`, retries: 4 }
  );
  return res.json ?? {};
}

/**
 * 日本時間の日付範囲を、AmazonがわかるUTC時刻に直す。
 * 例: 2026-07-31 〜 2026-07-31（日本時間の1日）
 *   → 2026-07-30T15:00:00Z 〜 2026-07-31T14:59:59Z
 */
export function rangeToUtc(fromISO, toISO) {
  const start = new Date(`${fromISO}T00:00:00+09:00`);
  const end = new Date(`${toISO}T23:59:59+09:00`);
  return { dataStartTime: start.toISOString(), dataEndTime: end.toISOString() };
}

/**
 * 注文レポートを依頼して、できあがりを待って、中身（Buffer）を返す。
 * @returns {Promise<Buffer>} レポートの生データ（タブ区切りテキスト）
 */
export async function fetchOrdersReport(fromISO, toISO, opts = {}) {
  const { dataStartTime, dataEndTime } = rangeToUtc(fromISO, toISO);
  const marketplaceId = optional('SPAPI_MARKETPLACE_ID') || MARKETPLACE_JP;

  // ① レポート作成を依頼
  const created = await call('POST', '/reports/2021-06-30/reports', {
    reportType: ORDERS_REPORT_TYPE,
    marketplaceIds: [marketplaceId],
    dataStartTime,
    dataEndTime,
  });
  const reportId = created.reportId;
  if (!reportId) throw new Error(`レポートの作成依頼に失敗しました: ${JSON.stringify(created).slice(0, 300)}`);
  console.log(`  レポート作成を依頼しました（ID: ${reportId}）。できあがりを待ちます …`);

  // ② できあがるまで待つ（15秒ごと、最大10分）
  const maxTries = opts.maxTries ?? 40;
  const intervalMs = opts.intervalMs ?? 15_000;
  let documentId = null;
  for (let i = 0; i < maxTries; i++) {
    const r = await call('GET', `/reports/2021-06-30/reports/${reportId}`);
    const status = r.processingStatus;
    if (status === 'DONE') { documentId = r.reportDocumentId; break; }
    if (status === 'FATAL' || status === 'CANCELLED') {
      throw new Error(
        `レポートの作成が${status === 'FATAL' ? '失敗' : 'キャンセル'}になりました。` +
          '期間内に注文が1件も無いときにもこうなることがあります。'
      );
    }
    await sleep(intervalMs);
  }
  if (!documentId) throw new Error('レポートのできあがりを待ちましたが、時間内に完成しませんでした。後でもう一度試してください。');

  // ③ ダウンロードして解凍
  const doc = await call('GET', `/reports/2021-06-30/documents/${documentId}`);
  if (!doc.url) throw new Error('レポートのダウンロードURLを取得できませんでした');

  let buf = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(doc.url);
    if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); break; }
    await sleep(2000 * (attempt + 1));
  }
  if (!buf) throw new Error('レポート本体のダウンロードに失敗しました');

  if (doc.compressionAlgorithm === 'GZIP') buf = gunzipSync(buf);
  return buf;
}
