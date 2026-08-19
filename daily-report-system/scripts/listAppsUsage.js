#!/usr/bin/env node
// ============================================================
//  [調査ツール] 全アプリの棚卸し（レコード件数・最終更新日）
// ------------------------------------------------------------
//  「使っていないアプリ」を仕分けるための一覧を出します。
//  出力: アプリID / 名前 / レコード件数 / アプリ設定の最終更新日
//  ★読み取りのみ。アプリには一切変更を加えません。
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

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
async function call(path) {
  const res = await fetchWithRetry(
    `${base()}${path}`,
    { method: 'GET', headers: { ...authHeader() } },
    { label: `kintone GET ${path}` }
  );
  return res.json ?? {};
}

async function recordCount(appId) {
  try {
    const r = await call(`/k/v1/records.json?app=${appId}&totalCount=true&query=${encodeURIComponent('limit 1')}`);
    return r.totalCount != null ? String(r.totalCount) : '?';
  } catch {
    return '権限なし';
  }
}

async function main() {
  const apps = [];
  for (let offset = 0; ; offset += 100) {
    const r = await call(`/k/v1/apps.json?limit=100&offset=${offset}`);
    apps.push(...(r.apps ?? []));
    if ((r.apps ?? []).length < 100) break;
  }
  console.log(`\nアプリ棚卸し（${apps.length}件）\n`);
  console.log('  ID   | レコード数 | 設定最終更新 | 名前');
  console.log('  ' + '-'.repeat(70));
  for (const a of apps) {
    const cnt = await recordCount(a.appId);
    const mod = (a.modifiedAt ?? '').slice(0, 10);
    console.log(`  ${String(a.appId).padStart(4)} | ${cnt.padStart(8)} | ${mod} | ${a.name}`);
  }
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
