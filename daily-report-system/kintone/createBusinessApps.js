// ============================================================
//  「在庫数」「広告費」の2アプリを自動作成する
// ------------------------------------------------------------
//  ※ アプリ作成はパスワード認証が必要です。
//     .env に KINTONE_USER と KINTONE_PASSWORD を一時的に設定してください。
//
//  実行:
//    node kintone/createBusinessApps.js            … 両方
//    node kintone/createBusinessApps.js inventory  … 在庫数のみ
//    node kintone/createBusinessApps.js adcost     … 広告費のみ
//    node kintone/createBusinessApps.js --dry-run  … 作らずに内容だけ表示
//
//  ★既存アプリは一切変更しません。新規に作るだけです。
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import * as inventory from './inventorySchema.js';
import * as adcost from './adCostSchema.js';

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

function authHeader() {
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'アプリ作成には KINTONE_USER と KINTONE_PASSWORD が必要です。\n' +
        '  .env に一時的に設定してください（作成後は消してかまいません）。'
    );
  }
  return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
}

async function call(method, path, body) {
  const res = await fetchWithRetry(
    `${base()}${path}`,
    {
      method,
      // ★GET に Content-Type を付けると kintone は 400 を返す
      headers:
        method === 'GET'
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
  console.log(`  ✅ 完了（appId=${app}）`);
  return app;
}

function describe(name, fields) {
  console.log(`\n── ${name} （${Object.keys(fields).length}項目）──`);
  for (const f of Object.values(fields)) {
    const extra = f.type === 'CALC' ? `  = ${f.expression}` : f.unique ? '  ※重複不可' : '';
    console.log(`  ${String(f.type).padEnd(17)} ${f.label}${extra}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDry = args.includes('--dry-run');
  const which = args.find((a) => !a.startsWith('--'));

  const targets = [];
  if (!which || which === 'inventory') targets.push(['inventory', inventory]);
  if (!which || which === 'adcost') targets.push(['adcost', adcost]);

  if (isDry) {
    console.log('[dry-run] 作成せず、内容だけ表示します。');
    for (const [, mod] of targets) describe(mod.APP_NAME, mod.FIELDS);
    return;
  }

  const results = {};
  for (const [key, mod] of targets) {
    results[key] = await createApp(mod.APP_NAME, mod.FIELDS);
  }

  console.log('\n──────── 次にやること ────────');
  if (results.inventory) console.log(`KINTONE_INVENTORY_APP_ID=${results.inventory}`);
  if (results.adcost) console.log(`KINTONE_ADCOST_APP_ID=${results.adcost}`);
  console.log('この行を .env に貼り付けてください。');
  console.log('その後 npm run dashboard で、在庫と広告費がダッシュボードに出ます。');
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
