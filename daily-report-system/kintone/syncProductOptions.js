#!/usr/bin/env node
// ============================================================
//  「商品」の選択肢を、対応表に合わせて更新する
// ------------------------------------------------------------
//  売上明細アプリの「商品」はドロップダウン（選択式）です。
//  選択肢に無い名前を書き込もうとすると kintone がエラーを返し、
//  その日の取込が丸ごと止まります。
//
//  新しい商品が増えたとき（config/product-aliases.json に足したとき）は、
//  このコマンドを1回だけ実行してください。
//
//    npm run kintone:sync-products
//    npm run kintone:sync-products -- --dry-run   … 変更点だけ表示
//
//  ★選択肢は「増やすだけ」です。既にある選択肢は消しません。
//    消すと、その選択肢が入っている過去のレコードが壊れるためです。
// ============================================================
import { optional, required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { productOptions } from './salesDetailSchema.js';

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

function authHeader() {
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'この操作には KINTONE_USER と KINTONE_PASSWORD が必要です（APIトークンでは変更できません）。\n' +
        '  .env に一時的に設定してください。'
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
        method === 'GET' ? { ...authHeader() } : { 'Content-Type': 'application/json', ...authHeader() },
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

/** サブテーブルの中にある目的のドロップダウンを探す */
export function findSubtableDropdown(properties, subtableCode, fieldCode) {
  const table = properties?.[subtableCode];
  if (!table || table.type !== 'SUBTABLE') return null;
  const field = table.fields?.[fieldCode];
  if (!field || field.type !== 'DROP_DOWN') return null;
  return { table, field };
}

/** 既存の選択肢を残したまま、足りないものだけ足す */
export function mergeOptions(current, wanted) {
  const merged = { ...current };
  let nextIndex = Object.values(current).reduce((m, o) => Math.max(m, Number(o.index) + 1), 0);
  const added = [];
  for (const label of wanted) {
    if (merged[label]) continue;
    merged[label] = { label, index: String(nextIndex++) };
    added.push(label);
  }
  return { merged, added };
}

async function main() {
  const isDry = process.argv.includes('--dry-run');
  const app = optional('KINTONE_SALES_DETAIL_APP_ID');
  if (!app) throw new Error('KINTONE_SALES_DETAIL_APP_ID が未設定です。');

  const form = await call('GET', `/k/v1/preview/app/form/fields.json?app=${app}`);
  const hit = findSubtableDropdown(form.properties, 'detail', 's_product');
  if (!hit) throw new Error('明細テーブルの「商品」フィールドが見つかりませんでした。');

  const { merged, added } = mergeOptions(hit.field.options ?? {}, productOptions());
  if (!added.length) {
    console.log('✅ 選択肢はすでに最新です。変更はありません。');
    return;
  }

  console.log(`追加する選択肢 ${added.length}件:`);
  for (const a of added) console.log(`  ・${a}`);
  if (isDry) {
    console.log('\n[dry-run] 実際の変更は行いませんでした。');
    return;
  }

  await call('PUT', '/k/v1/preview/app/form/fields.json', {
    app,
    properties: {
      detail: {
        type: 'SUBTABLE',
        code: 'detail',
        fields: { s_product: { ...hit.field, options: merged } },
      },
    },
  });
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  console.log('デプロイ中 …');
  await waitDeploy(app);
  console.log('✅ 完了しました。');
}

if (process.argv[1] && process.argv[1].endsWith('syncProductOptions.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
