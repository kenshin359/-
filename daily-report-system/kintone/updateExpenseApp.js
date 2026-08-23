#!/usr/bin/env node
// ============================================================
//  経費管理アプリを最新定義に更新する
// ------------------------------------------------------------
//  expenseSchema.js の 費目・支払方法・利用者 をアプリに反映します。
//  （利用者の追加や費目の変更はスキーマを直してこれを実行）
//  実行: node kintone/updateExpenseApp.js --app=49
//  ★対象フィールドだけを更新。レコードには一切触りません。
// ============================================================
import { required, optional } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { FIELDS } from './expenseSchema.js';

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
  const app = hit ? hit.slice(6) : optional('KINTONE_EXPENSE_APP_ID', '49');
  await call('PUT', '/k/v1/preview/app/form/fields.json', {
    app,
    properties: {
      member: FIELDS.member,
      category: FIELDS.category,
      pay_method: FIELDS.pay_method,
    },
  });
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  await waitDeploy(app);
  console.log(`✅ 経費管理アプリを更新しました（appId=${app}）`);
  console.log(`   利用者: ${Object.keys(FIELDS.member.options).length}名`);
  console.log(`   費目: ${Object.keys(FIELDS.category.options).join(' / ')}`);
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
