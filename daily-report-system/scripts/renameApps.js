#!/usr/bin/env node
// ============================================================
//  アプリ名に「自動入力／手動入力」の目印をつける
// ------------------------------------------------------------
//  自作アプリのみ対象。チーム作成のアプリ（日報・O2 KPI等）には
//  一切触れません。何度実行しても同じ結果になります（冪等）。
//  実行: node scripts/renameApps.js [--dry-run]
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

const DRY = process.argv.includes('--dry-run');

// アプリ番号 → 新しい名前
const RENAMES = {
  29: '売上明細【🤖自動入力】',
  30: '毎朝KPI報告・広告CSV添付【✍手動・毎日】',
  32: '案件報告 クリエイター管理【✍手動・随時】',
  35: '在庫報告 CS出荷後【✍手動・毎日】',
  36: '案件依頼 インフルエンサーPR【✍手動・随時】',
  38: 'タスク管理 チーム進捗【✍手動・毎朝】',
  39: 'リベティ・デイリーニュース【🤖自動入力】',
  40: '会社名簿 社員・顧客・専門家【✍手動・随時】',
  41: 'ログイン情報 社内アカウント【✍手動・随時】',
  42: '広告費記載／全て【✍手動・毎日】',
  43: '議事録 ミーティング記録【🤖自動入力】',
  44: '会社カレンダー 統合【✍手動・随時】',
};

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
  for (const [app, name] of Object.entries(RENAMES)) {
    if (DRY) {
      console.log(`[dry-run] ${app} → ${name}`);
      continue;
    }
    try {
      await call('PUT', '/k/v1/preview/app/settings.json', { app, name });
      await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
      await waitDeploy(app);
      console.log(`✅ ${app} → ${name}`);
    } catch (e) {
      const msg = JSON.stringify(e.body ?? e.message);
      if (msg.includes('GAIA_AP01')) {
        console.log(`⏭ ${app} は存在しないためスキップ（削除済み）`);
      } else {
        throw e;
      }
    }
  }
  console.log('完了');
}

main().catch((e) => {
  console.error('エラー:', JSON.stringify(e.body ?? e.message).slice(0, 300));
  process.exit(1);
});
