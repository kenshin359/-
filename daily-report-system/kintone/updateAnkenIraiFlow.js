#!/usr/bin/env node
// ============================================================
//  案件依頼アプリ（36）を「インフルエンサー進行フロー」に合わせて更新
// ------------------------------------------------------------
//  docs/influencer-workflow.md の8ステップ運用に必要な項目を足します。
//
//  ・ステータスに ④〜⑧ の段階を追加
//      発送先・サイズ確認中／初稿提出目安 確認中／初稿待ち／
//      初稿確認・修正中／投稿日調整中
//  ・項目を追加
//      紹介サイズ／初稿提出目安／初稿提出目安メモ／発送日／
//      制作指示パターン／初稿受領日／投稿確定日／ストーリー投稿
//  ・一覧ビュー「⏳ 初稿待ち」を追加
//
//  ★追加だけを行います。
//    既存の選択肢・項目・ビュー・レコードは消しません。
//    もう一度実行しても二重には増えません（あるものは飛ばします）。
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { FIELDS, STATUS_OPTIONS, VIEWS } from './ankenIraiSchema.js';

const APP = process.env.KINTONE_ANKEN_IRAI_APP_ID || '36';

// フロー運用のために足す項目（既存アプリに無いものだけ追加）
const NEW_FIELD_CODES = [
  'size',
  'draft_eta',
  'draft_eta_note',
  'ship_date',
  'pattern',
  'draft_date',
  'post_date',
  'story',
];

const NEW_VIEW_NAME = '⏳ 初稿待ち';

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

// 既存の選択肢は残したまま、STATUS_OPTIONS の並びで足りないものを足す
function mergeStatusOptions(current) {
  const existing = Object.keys(current ?? {});
  const merged = STATUS_OPTIONS.slice();
  for (const o of existing) if (!merged.includes(o)) merged.push(o); // 手で足された選択肢を守る
  return merged;
}

async function main() {
  console.log(`案件依頼アプリ(app=${APP})を進行フロー対応に更新します …`);

  const form = await call('GET', `/k/v1/preview/app/form/fields.json?app=${APP}`);
  const props = form.properties ?? {};

  // ① 足りない項目を追加
  const toAdd = {};
  for (const code of NEW_FIELD_CODES) {
    if (props[code]) { console.log(`  ・${code} は既にあります（スキップ）`); continue; }
    toAdd[code] = FIELDS[code];
  }
  if (Object.keys(toAdd).length) {
    await call('POST', '/k/v1/preview/app/form/fields.json', { app: APP, properties: toAdd });
    console.log(`  ① 項目を${Object.keys(toAdd).length}個追加: ${Object.values(toAdd).map((f) => f.label).join(' / ')}`);
  } else {
    console.log('  ① 追加する項目はありませんでした');
  }

  // ② ステータスの選択肢を拡張（既存の選択肢は消さない）
  const statusNow = props.status?.options;
  const merged = mergeStatusOptions(statusNow);
  const before = Object.keys(statusNow ?? {}).length;
  if (merged.length !== before) {
    await call('PUT', '/k/v1/preview/app/form/fields.json', {
      app: APP,
      properties: {
        status: {
          type: 'DROP_DOWN',
          code: 'status',
          label: 'ステータス',
          options: opts(merged),
          defaultValue: props.status?.defaultValue ?? '依頼前',
        },
      },
    });
    console.log(`  ② ステータスの選択肢: ${before} → ${merged.length} 個`);
  } else {
    console.log('  ② ステータスの選択肢は最新です');
  }

  // ③ 一覧ビュー「⏳ 初稿待ち」を追加（既存ビューはそのまま）
  const viewRes = await call('GET', `/k/v1/preview/app/views.json?app=${APP}`);
  const views = viewRes.views ?? {};
  if (views[NEW_VIEW_NAME]) {
    console.log('  ③ ビュー「⏳ 初稿待ち」は既にあります（スキップ）');
  } else {
    const maxIndex = Math.max(-1, ...Object.values(views).map((v) => Number(v.index ?? 0)));
    views[NEW_VIEW_NAME] = { ...VIEWS[NEW_VIEW_NAME], index: String(maxIndex + 1) };
    await call('PUT', '/k/v1/preview/app/views.json', { app: APP, views });
    console.log('  ③ ビュー「⏳ 初稿待ち」を追加しました');
  }

  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app: APP }] });
  console.log('  ④ デプロイ中 …');
  await waitDeploy(APP);
  console.log('✅ 完了: 案件依頼アプリを進行フロー（8ステップ）対応にしました');
}
main().catch((e) => { console.error('エラー:', e.message, JSON.stringify(e.body ?? '')); process.exit(1); });
