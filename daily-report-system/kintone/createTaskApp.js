// ============================================================
//  「業務タスク」アプリを自動作成する
// ------------------------------------------------------------
//  ※ アプリ作成はパスワード認証が必要です。
//     .env に KINTONE_USER と KINTONE_PASSWORD を一時的に設定してください。
//
//  実行:
//    node kintone/createTaskApp.js            … 作成する
//    node kintone/createTaskApp.js --dry-run  … 作らずに項目だけ表示
//
//  作成後、表示された appId を .env の KINTONE_TASK_APP_ID に設定してください。
//  ★既存アプリは一切変更しません。新規に作るだけです。
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import * as task from './taskAppSchema.js';

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
      headers: method === 'GET' ? { ...authHeader() } : { 'Content-Type': 'application/json', ...authHeader() },
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
  const dry = process.argv.includes('--dry-run');
  if (dry) {
    console.log(`\n── ${task.APP_NAME} （${Object.keys(task.FIELDS).length}項目）──`);
    for (const f of Object.values(task.FIELDS)) {
      const opts = f.options ? '  {' + Object.keys(f.options).join(' / ') + '}' : '';
      console.log(`  ${String(f.type).padEnd(17)} ${f.label}${f.required ? ' *' : ''}${opts}`);
    }
    console.log('\n(--dry-run のため作成はしていません)');
    return;
  }

  console.log(`\n▶ アプリ作成: 「${task.APP_NAME}」`);
  const created = await call('POST', '/k/v1/preview/app.json', { name: task.APP_NAME });
  const app = created.app;
  console.log(`  ① 器を作成 app=${app}`);
  await call('POST', '/k/v1/preview/app/form/fields.json', { app, properties: task.FIELDS });
  console.log(`  ② フィールド ${Object.keys(task.FIELDS).length} 個を追加`);
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  console.log('  ③ デプロイ中 …');
  await waitDeploy(app);
  console.log(`  ✅ 完了（appId=${app}）`);
  console.log(`\n次の手順：`);
  console.log(`  1) .env に KINTONE_TASK_APP_ID=${app} を設定`);
  console.log(`  2) レコードの読み取り用に APIトークンを発行し KINTONE_API_TOKEN_TASK に設定（推奨）`);
  console.log(`  3) npm run task:build でカレンダーHTMLを生成`);
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
