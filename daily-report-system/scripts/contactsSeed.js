#!/usr/bin/env node
// ============================================================
//  会社情報アプリへの連絡先登録
// ------------------------------------------------------------
//  連絡先データは環境変数 SEED_RECORDS_B64（base64のJSON配列）で
//  受け取ります。公開リポジトリのため、コードやログには
//  連絡先の中身を一切出しません。
//
//  JSONの形: [{category,name,office,phone,email,address,memo}, ...]
//  同じ「名前」のレコードがあれば上書き、なければ新規追加します。
// ============================================================
import { required, optional } from '../lib/env.js';
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

async function main() {
  const hit = process.argv.find((a) => a.startsWith('--app='));
  const app = hit ? hit.slice(6) : optional('KINTONE_CONTACTS_APP_ID');
  if (!app) throw new Error('--app=<アプリ番号> を指定してください');

  const b64 = process.env.SEED_RECORDS_B64 || '';
  if (!b64.trim()) {
    console.log('SEED_RECORDS_B64 が空のため、登録はスキップしました（アプリ作成のみ）。');
    return;
  }
  const items = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  let added = 0;
  let updated = 0;
  for (const it of items) {
    const record = {};
    for (const k of ['category', 'name', 'office', 'phone', 'email', 'address', 'memo']) {
      if (it[k] != null) record[k] = { value: String(it[k]) };
    }
    const q = encodeURIComponent(`name = "${String(it.name).replace(/"/g, '')}" limit 1`);
    const found = (await call('GET', `/k/v1/records.json?app=${app}&query=${q}`)).records ?? [];
    if (found.length) {
      await call('PUT', '/k/v1/record.json', { app, id: found[0].$id.value, record });
      updated++;
    } else {
      await call('POST', '/k/v1/record.json', { app, record });
      added++;
    }
  }
  console.log(`✅ 連絡先を登録しました（新規${added}件・更新${updated}件）`);
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
