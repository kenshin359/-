#!/usr/bin/env node
// ============================================================
//  販促費管理アプリの費目を最新定義に更新する（案A運用）
// ------------------------------------------------------------
//  promoCostSchema.js の category 定義をそのままアプリに反映します。
//  実行: node kintone/updatePromoApp.js --app=42
//  ★対象アプリの「費目」フィールドだけを更新。他は一切変更しません。
// ============================================================
import { required, optional } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { FIELDS } from './promoCostSchema.js';

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}
function authHeader() {
  return {
    'X-Cybozu-Authorization': Buffer.from(
      `${required('KINTONE_USER')}:${required('KINTONE_PASSWORD')}`
    ).toString('base64'),
  };
}
async function call(method, path, body) {
  const res = await fetchWithRetry(
    `${base()}${path}`,
    {
      method,
      headers: method === 'GET'
        ? { ...authHeader() }
        : { 'Content-Type': 'application/json', ...authHeader() },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    },
    { label: `kintone ${method} ${path}` }
  );
  return res.json ?? {};
}

async function waitDeploy(app) {
  for (let i = 0; i < 40; i++) {
    const r = await call('GET', `/k/v1/preview/app/deploy.json?apps[0]=${app}`);
    const status = r.apps?.[0]?.status;
    if (status === 'SUCCESS') return;
    if (status === 'FAIL' || status === 'CANCEL') throw new Error(`デプロイ失敗: ${status}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('デプロイがタイムアウトしました');
}

async function main() {
  const hit = process.argv.find((a) => a.startsWith('--app='));
  const app = hit ? hit.slice(6) : optional('KINTONE_PROMO_APP_ID', '42');
  await call('PUT', '/k/v1/preview/app/form/fields.json', {
    app,
    properties: { category: FIELDS.category },
  });
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  await waitDeploy(app);
  console.log(`✅ 費目を更新しました（appId=${app}）: ${Object.keys(FIELDS.category.options).join(' / ')}`);
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
