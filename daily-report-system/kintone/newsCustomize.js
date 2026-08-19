#!/usr/bin/env node
// ============================================================
//  デイリーニュースアプリに「📱 ニュース」カスタムビューと
//  カード型フィードのJavaScriptを設定する（作成後に1回だけ実行）
// ------------------------------------------------------------
//  実行: node kintone/newsCustomize.js --app=<アプリ番号>
//  ★対象のニュースアプリ以外は一切変更しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}
function authHeader() {
  const user = required('KINTONE_USER');
  const pass = required('KINTONE_PASSWORD');
  return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
}
async function call(method, path_, body) {
  const res = await fetchWithRetry(
    `${base()}${path_}`,
    {
      method,
      headers: method === 'GET'
        ? { ...authHeader() }
        : { 'Content-Type': 'application/json', ...authHeader() },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    },
    { label: `kintone ${method} ${path_}` }
  );
  return res.json ?? {};
}

async function uploadFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'text/javascript' }), path.basename(filePath));
  const res = await fetch(`${base()}/k/v1/file.json`, {
    method: 'POST',
    headers: { ...authHeader() },
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`ファイルアップロード失敗: ${JSON.stringify(json)}`);
  return json.fileKey;
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
  const app = hit ? hit.slice(6) : process.env.KINTONE_NEWS_APP_ID;
  if (!app) throw new Error('--app=<アプリ番号> を指定してください');

  // ① カード表示用JSをアップロードして適用（PC・モバイル両方）
  //    ★kintoneは同じfileKeyを2箇所で使えないため、2回アップロードする
  const jsPath = path.join(__dirname, 'customize', 'newsFeed.js');
  const desktopKey = await uploadFile(jsPath);
  const mobileKey = await uploadFile(jsPath);
  await call('PUT', '/k/v1/preview/app/customize.json', {
    app,
    scope: 'ALL',
    desktop: { js: [{ type: 'FILE', file: { fileKey: desktopKey } }], css: [] },
    mobile: { js: [{ type: 'FILE', file: { fileKey: mobileKey } }], css: [] },
  });
  console.log('① カード表示JSを設定しました');

  // ② 「📱 ニュース」カスタムビューを追加（既存ビューは残す）
  const cur = await call('GET', `/k/v1/preview/app/views.json?app=${app}`);
  const views = cur.views ?? {};
  views['📱 ニュース'] = {
    index: 0,
    type: 'CUSTOM',
    name: '📱 ニュース',
    html: '<div id="libetee-news-root"></div>',
    pager: false,
    device: 'DESKTOP',
  };
  if (views['新しい順']) views['新しい順'].index = 1;
  await call('PUT', '/k/v1/preview/app/views.json', { app, views });
  console.log('② 「📱 ニュース」ビューを追加しました');

  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  await waitDeploy(app);
  console.log(`✅ 完了（appId=${app}）。アプリを開いて一覧「📱 ニュース」を選んでください。`);
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
