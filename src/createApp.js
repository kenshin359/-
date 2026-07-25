// 「売上日報（新）」アプリを自動で作成する。
//   1. アプリの器を作成（プレビュー環境）
//   2. 仕様書どおりのフィールドを追加
//   3. 本番へデプロイ
// ※ アプリ作成はパスワード認証が必須（KINTONE_USER + KINTONE_PASSWORD）。
//   実行: npm run create-app
import { kintone, qs } from './client.js';
import { FIELDS } from './appSchema.js';

const NAME = process.env.KINTONE_NEW_APP_NAME || '売上日報（新）';

async function waitDeploy(app) {
  for (let i = 0; i < 40; i++) {
    const r = await kintone('GET', `/k/v1/preview/app/deploy.json?${qs({ 'apps[0]': app })}`);
    const status = r.apps?.[0]?.status;
    if (status === 'SUCCESS') return;
    if (status === 'FAIL' || status === 'CANCEL') throw new Error(`デプロイ失敗: ${status}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('デプロイがタイムアウトしました');
}

async function main() {
  console.log(`アプリを作成します: 「${NAME}」`);

  const created = await kintone('POST', '/k/v1/preview/app.json', { name: NAME });
  const app = created.app;
  console.log(`  ① 器を作成 … app=${app}`);

  await kintone('POST', '/k/v1/preview/app/form/fields.json', { app, properties: FIELDS });
  console.log(`  ② フィールド ${Object.keys(FIELDS).length} 個を追加`);

  await kintone('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  console.log('  ③ デプロイ中 …');
  await waitDeploy(app);

  console.log('\n完了 ✅  新アプリが本番に反映されました。');
  console.log(`   .env に次を設定してください →  KINTONE_NEW_APP_ID=${app}`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
