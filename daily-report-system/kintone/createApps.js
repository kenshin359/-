// ============================================================
//  スタッフ日報 / AI経営日報 の2アプリを自動作成する
// ------------------------------------------------------------
//  ※ アプリ「作成」はパスワード認証が必要です。
//     .env に KINTONE_USER と KINTONE_PASSWORD を一時的に設定してください
//     （作成後は削除してOK。運用時は APIトークンだけで動きます）。
//
//  実行:  node kintone/createApps.js
//         node kintone/createApps.js staff   … スタッフ日報のみ
//         node kintone/createApps.js ai      … AI経営日報のみ
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import * as staff from './staffReportSchema.js';
import * as ai from './aiReportSchema.js';

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

// アプリ作成は管理操作なのでパスワード認証を使う
function authHeader() {
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (!user || !pass) {
    throw new Error('アプリ作成には KINTONE_USER と KINTONE_PASSWORD が必要です（.env に一時設定してください）');
  }
  const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
  return { 'X-Cybozu-Authorization': encoded };
}

async function call(method, path, body) {
  const res = await fetchWithRetry(
    `${base()}${path}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeader() },
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

async function createApp(name, fields) {
  console.log(`\n▶ アプリ作成: 「${name}」`);
  const created = await call('POST', '/k/v1/preview/app.json', { name });
  const app = created.app;
  console.log(`  ① 器を作成 app=${app}`);
  await call('POST', '/k/v1/preview/app/form/fields.json', { app, properties: fields });
  console.log(`  ② フィールド ${Object.keys(fields).length} 個を追加`);
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  console.log('  ③ デプロイ中 …');
  await waitDeploy(app);
  console.log(`  ✅ 完了 → .env に設定してください（appId=${app}）`);
  return app;
}

async function main() {
  const which = process.argv[2]; // 'staff' | 'ai' | undefined(両方)
  const results = {};
  if (!which || which === 'staff') {
    results.staff = await createApp(staff.APP_NAME, staff.FIELDS);
  }
  if (!which || which === 'ai') {
    results.ai = await createApp(ai.APP_NAME, ai.FIELDS);
  }
  console.log('\n──────── 次にやること ────────');
  if (results.staff) console.log(`KINTONE_DAILY_REPORT_APP_ID=${results.staff}`);
  if (results.ai) console.log(`KINTONE_AI_REPORT_APP_ID=${results.ai}`);
  console.log('各アプリの設定画面で APIトークンを発行し、.env に設定してください。');
  console.log('（スタッフ日報=閲覧, AI経営日報=追加/編集 の権限）');
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
