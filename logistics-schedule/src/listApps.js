// アプリ一覧とIDを表示するヘルパー。作成後の KINTONE_LOGI_APP_ID 確認に使う。
//   実行: npm run apps
import { kintone, qs } from './client.js';

async function main() {
  const res = await kintone('GET', `/k/v1/apps.json?${qs({ limit: 100 })}`);
  const apps = res.apps || [];
  if (!apps.length) {
    console.log('表示できるアプリがありません（このアカウントに閲覧権限がない可能性があります）。');
    return;
  }
  console.log(`アプリ数: ${apps.length}\n`);
  for (const a of apps) {
    console.log(`  [ID ${String(a.appId).padStart(4)}]  ${a.name}`);
  }
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
