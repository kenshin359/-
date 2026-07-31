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
//    node kintone/createBusinessApps.js intake     … CSV提出ボックスのみ
//    node kintone/createBusinessApps.js --dry-run  … 作らずに内容だけ表示
//
//  ★既存アプリは一切変更しません。新規に作るだけです。
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import * as inventory from './inventorySchema.js';
import * as adcost from './adCostSchema.js';
import * as intake from './intakeSchema.js';
import { VIEWS as AD_VIEWS, REPORTS as AD_REPORTS } from './adCostViews.js';
import { VIEWS as INTAKE_VIEWS } from './intakeViews.js';

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

async function createApp(name, fields, extras = {}) {
  console.log(`\n▶ アプリ作成: 「${name}」`);
  const created = await call('POST', '/k/v1/preview/app.json', { name });
  const app = created.app;
  console.log(`  ① 器を作成 app=${app}`);
  await call('POST', '/k/v1/preview/app/form/fields.json', { app, properties: fields });
  console.log(`  ② フィールド ${Object.keys(fields).length} 個を追加`);

  // 一覧（昨日 / 今月 / 先月 / すべて）
  if (extras.views) {
    await call('PUT', '/k/v1/preview/app/views.json', { app, views: extras.views });
    console.log(`  ③ 一覧 ${Object.keys(extras.views).length} 個を設定`);
  }

  // グラフ（今月の総額・商品別・媒体別・日ごとの推移）
  // ★グラフはアプリが無くても運用できる「おまけ」なので、
  //   ここで失敗しても作成全体は止めません。
  if (extras.reports) {
    try {
      await call('PUT', '/k/v1/preview/app/reports.json', { app, reports: extras.reports });
      console.log(`  ④ グラフ ${Object.keys(extras.reports).length} 個を設定`);
    } catch (e) {
      console.warn(`  ⚠ グラフの設定に失敗しました（アプリ本体は作成できています）`);
      console.warn(`     理由: ${JSON.stringify(e.body ?? e.message).slice(0, 300)}`);
    }
  }

  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  console.log('  ⑤ デプロイ中 …');
  await waitDeploy(app);
  console.log(`  ✅ 完了（appId=${app}）`);
  return app;
}

function describe(name, fields, indent = '  ') {
  if (indent === '  ') console.log(`\n── ${name} （${Object.keys(fields).length}項目）──`);
  for (const f of Object.values(fields)) {
    const extra = f.type === 'CALC' ? `  = ${f.expression}` : f.unique ? '  ※重複不可' : '';
    console.log(`${indent}${String(f.type).padEnd(17)} ${f.label}${extra}`);
    if (f.type === 'SUBTABLE') describe(f.label, f.fields, `${indent}    `);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDry = args.includes('--dry-run');
  const which = args.find((a) => !a.startsWith('--'));

  const targets = [];
  if (!which || which === 'inventory') targets.push(['inventory', inventory]);
  if (!which || which === 'adcost') targets.push(['adcost', adcost]);
  if (!which || which === 'intake') targets.push(['intake', intake]);

  if (isDry) {
    console.log('[dry-run] 作成せず、内容だけ表示します。');
    for (const [, mod] of targets) describe(mod.APP_NAME, mod.FIELDS);
    return;
  }

  const extrasFor = {
    adcost: { views: AD_VIEWS, reports: AD_REPORTS },
    intake: { views: INTAKE_VIEWS },
  };

  const results = {};
  for (const [key, mod] of targets) {
    results[key] = await createApp(mod.APP_NAME, mod.FIELDS, extrasFor[key] ?? {});
  }

  console.log('\n──────── 次にやること ────────');
  if (results.inventory) console.log(`KINTONE_INVENTORY_APP_ID=${results.inventory}`);
  if (results.adcost) console.log(`KINTONE_ADCOST_APP_ID=${results.adcost}`);
  if (results.intake) console.log(`KINTONE_INTAKE_APP_ID=${results.intake}`);
  console.log('この行を .env に貼り付けてください。');
  if (results.adcost) {
    console.log('');
    console.log('広告費管理アプリの使い方:');
    console.log('  ・一覧の「昨日」「今月」で総広告費が見られます');
    console.log('  ・グラフの「今月 商品別の広告費」で商品ごとが見られます');
    console.log('  ・CSVから取り込む場合: npm run ads:import -- <CSVファイル…>');
  }
  console.log('その後 npm run dashboard で、在庫と広告費がダッシュボードに出ます。');
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
