#!/usr/bin/env node
// ============================================================
//  毎朝KPI報告アプリに「ブランド別・広告CSV添付欄」を追加
// ------------------------------------------------------------
//  ファイル名の頭に google_ / meta_ … を付ける運用をやめて、
//  ブランド×媒体ごとの専用添付欄に入れるだけにします。
//  既にある欄はスキップ（何度実行しても安全）。
//  実行: node scripts/updateKpiAdFields.js
// ============================================================
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';

// 追加する添付欄（コード → 表示名）
const FIELDS = {
  ad_lib_meta: 'リベティ｜メタ広告CSV（毎日）',
  ad_lib_rpp: 'リベティ｜RPP CSV（毎日）',
  ad_lib_amazon: 'リベティ｜Amazon広告CSV（毎日）',
  ad_lib_tiktok: 'リベティ｜TikTok広告CSV（毎日）',
  ad_lib_anken: 'リベティ｜案件依頼（あった時だけ）',
  ad_lib_prtimes: 'リベティ｜PRタイムズ（あった時だけ）',
  ad_o2_google: 'O2｜Google広告CSV（毎日）',
  ad_o2_meta: 'O2｜メタ広告CSV（毎日）',
  ad_o2_anken: 'O2｜案件依頼（あった時だけ）',
  ad_gad_meta: 'ガジェティ｜メタ広告CSV（毎日）',
  ad_gad_anken: 'ガジェティ｜案件依頼（あった時だけ）',
};

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

async function main() {
  const app = optional('KINTONE_KPI_APP_ID', '30');
  const cur = await call('GET', `/k/v1/preview/app/form/fields.json?app=${app}`);
  const existing = new Set(Object.keys(cur.properties ?? {}));

  const props = {};
  for (const [code, label] of Object.entries(FIELDS)) {
    if (existing.has(code)) continue;
    props[code] = { type: 'FILE', code, label };
  }
  if (!Object.keys(props).length) {
    console.log('追加なし（全ての添付欄が作成済み）');
    return;
  }
  await call('POST', '/k/v1/preview/app/form/fields.json', { app, properties: props });
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  await waitDeploy(app);
  console.log(`✅ 添付欄を${Object.keys(props).length}個追加してデプロイしました`);
}

main().catch((e) => {
  console.error('エラー:', e.message, JSON.stringify(e.body ?? '').slice(0, 300));
  process.exit(1);
});
