#!/usr/bin/env node
// ============================================================
//  案件依頼アプリ（36）の選択肢を追加更新
// ------------------------------------------------------------
//  ・案件種別に「テレビ出演」「プレスリリース」を追加
//  ・担当者に「黒葛原」を追加
//  既存レコード・他フィールドには触りません。
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

const APP = process.env.KINTONE_ANKEN_IRAI_APP_ID || '36';

function base() { return required('KINTONE_BASE_URL').replace(/\/$/, ''); }
function authHeader() {
  const user = required('KINTONE_USER');
  const pass = required('KINTONE_PASSWORD');
  return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
}
async function call(method, path, body) {
  const res = await fetchWithRetry(`${base()}${path}`, {
    method,
    headers: method === 'GET' ? { ...authHeader() } : { 'Content-Type': 'application/json', ...authHeader() },
    body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
  }, { label: `kintone ${method} ${path}` });
  return res.json ?? {};
}
async function waitDeploy(app) {
  for (let i = 0; i < 40; i++) {
    const r = await call('GET', `/k/v1/preview/app/deploy.json?apps[0]=${app}`);
    const s = r.apps?.[0]?.status;
    if (s === 'SUCCESS') return;
    if (s === 'FAIL' || s === 'CANCEL') throw new Error(`デプロイ失敗: ${s}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('デプロイがタイムアウトしました');
}

const opts = (list) => Object.fromEntries(list.map((o, i) => [o, { label: o, index: String(i) }]));

async function main() {
  console.log(`案件依頼アプリ(app=${APP})の選択肢を更新します …`);
  const kind = ['インフルエンサー投稿', 'ギフティング（商品提供）', 'PRタイアップ', 'アンバサダー',
    'メディア掲載', 'テレビ出演', 'プレスリリース', 'その他'];
  const tantou = ['西岡', '淵田', '角南', '黒葛原', 'その他'];
  await call('PUT', '/k/v1/preview/app/form/fields.json', {
    app: APP,
    properties: {
      kind: { type: 'DROP_DOWN', code: 'kind', label: '案件種別', options: opts(kind), defaultValue: 'インフルエンサー投稿' },
      tantou: { type: 'DROP_DOWN', code: 'tantou', label: '担当者', options: opts(tantou), defaultValue: '西岡' },
    },
  });
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app: APP }] });
  await waitDeploy(APP);
  console.log('✅ 完了: 種別にテレビ出演・プレスリリース、担当者に黒葛原を追加しました');
}
main().catch((e) => { console.error('エラー:', e.message, JSON.stringify(e.body ?? '')); process.exit(1); });
