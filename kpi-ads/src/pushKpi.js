// KPIアプリへ「1日1レコード」を upsert（同じ日付があれば更新、なければ新規）。
// フィールドコードは環境変数で上書き可能。既定値は設計書の romaji コード。
import { kintone, qs } from './kintoneClient.js';

const APP = () => {
  const id = process.env.KINTONE_KPI_APP_ID;
  if (!id) throw new Error('KINTONE_KPI_APP_ID が未設定です（KPIアプリのID）。');
  return id;
};

// 論理名 → kintone フィールドコード の対応。
// アプリ側のフィールドコードをこの値に合わせるか、環境変数で実際のコードに上書きする。
export const FIELD = {
  date:          process.env.KPI_FC_DATE          || 'date',
  access:        process.env.KPI_FC_ACCESS        || 'access',
  signups:       process.env.KPI_FC_SIGNUPS       || 'signups',
  sales_stores:  process.env.KPI_FC_SALES_STORES  || 'sales_stores',
  sales_shopify: process.env.KPI_FC_SALES_SHOPIFY || 'sales_shopify',
  ad_google:     process.env.KPI_FC_AD_GOOGLE     || 'ad_google',
  ad_meta:       process.env.KPI_FC_AD_META       || 'ad_meta',
};

async function findRecordByDate(date) {
  const query = `${FIELD.date} = "${date}" limit 1`;
  const path = `/k/v1/records.json?${qs({ app: APP(), query })}`;
  const res = await kintone('GET', path);
  return res.records && res.records[0];
}

// vals: { access, signups, sales_stores, sales_shopify, ad_google, ad_meta }
// undefined のキーは送らない（＝手入力した値を空で上書きしない）。
export async function upsertDaily(date, vals) {
  const record = {};
  record[FIELD.date] = { value: date };
  for (const [key, v] of Object.entries(vals)) {
    if (v === undefined || v === null) continue;
    if (!FIELD[key]) continue;
    record[FIELD[key]] = { value: String(v) };
  }

  const existing = await findRecordByDate(date);
  if (existing) {
    await kintone('PUT', '/k/v1/record.json', { app: APP(), id: existing.$id.value, record });
    return 'updated';
  }
  await kintone('POST', '/k/v1/record.json', { app: APP(), record });
  return 'created';
}
