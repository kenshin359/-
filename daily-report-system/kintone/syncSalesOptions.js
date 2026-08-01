#!/usr/bin/env node
// ============================================================
//  売上明細アプリの「選択肢」を、対応表に合わせて更新する
// ------------------------------------------------------------
//  このアプリの 商品 / 販売先 / 入力方法 はドロップダウン（選択式）です。
//  選択肢に無い名前を書き込もうとすると kintone がエラーを返し、
//  その日の取込が丸ごと止まります。
//
//  新しい商品や販売先が増えたときは、このコマンドを1回だけ実行してください。
//
//    npm run kintone:sync-options
//    npm run kintone:sync-options -- --dry-run   … 変更点だけ表示
//
//  ★選択肢は「増やすだけ」です。既にある選択肢は消しません。
//    消すと、その選択肢が入っている過去のレコードが壊れるためです。
// ============================================================
import { optional, required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { productOptions, CHANNEL_OPTIONS, SOURCE_OPTIONS } from './salesDetailSchema.js';

/** どのフィールドを、どの一覧に合わせるか */
export function targets() {
  return [
    { table: 'detail', code: 's_product', label: '商品', wanted: productOptions() },
    { table: 'detail', code: 's_channel', label: '販売先', wanted: CHANNEL_OPTIONS },
    { table: null, code: 'source', label: '入力方法', wanted: SOURCE_OPTIONS },
  ];
}

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

/** ドロップダウンを探す（サブテーブルの中でも、直下でも） */
export function findDropdown(properties, subtableCode, fieldCode) {
  if (!subtableCode) {
    const f = properties?.[fieldCode];
    return f && f.type === 'DROP_DOWN' ? f : null;
  }
  const table = properties?.[subtableCode];
  if (!table || table.type !== 'SUBTABLE') return null;
  const f = table.fields?.[fieldCode];
  return f && f.type === 'DROP_DOWN' ? f : null;
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
  const properties = {};
  let totalAdded = 0;

  for (const t of targets()) {
    const field = findDropdown(form.properties, t.table, t.code);
    if (!field) {
      console.warn(`  ⚠ 「${t.label}」が見つかりませんでした（飛ばします）`);
      continue;
    }
    const { merged, added } = mergeOptions(field.options ?? {}, t.wanted);
    if (!added.length) continue;

    console.log(`「${t.label}」に追加する選択肢 ${added.length}件:`);
    for (const a of added) console.log(`  ・${a}`);
    totalAdded += added.length;

    const patched = { ...field, options: merged };
    if (t.table) {
      properties[t.table] = properties[t.table] ?? { type: 'SUBTABLE', code: t.table, fields: {} };
      properties[t.table].fields[t.code] = patched;
    } else {
      properties[t.code] = patched;
    }
  }

  if (!totalAdded) {
    console.log('✅ 選択肢はすでに最新です。変更はありません。');
    return;
  }
  if (isDry) {
    console.log('\n[dry-run] 実際の変更は行いませんでした。');
    return;
  }

  await call('PUT', '/k/v1/preview/app/form/fields.json', { app, properties });
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  console.log('デプロイ中 …');
  await waitDeploy(app);
  console.log('✅ 完了しました。');
}

if (process.argv[1] && process.argv[1].endsWith('syncSalesOptions.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
