// 「在庫」アプリを自動で作成する（フィールド追加＋一覧ビュー＋デプロイ）。
// ※ アプリ作成はパスワード認証が必須（KINTONE_USER + KINTONE_PASSWORD）。
//   実行: npm run create-inventory-app
import { kintone, qs } from './client.js';
import { FIELDS, LIST_FIELDS } from './inventorySchema.js';

const NAME = process.env.KINTONE_INV_APP_NAME || '在庫';

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

  await kintone('PUT', '/k/v1/preview/app/views.json', {
    app,
    views: {
      在庫一覧: { type: 'LIST', name: '在庫一覧', index: '0', fields: LIST_FIELDS, sort: 'stock_total asc' },
    },
  });
  console.log('  ③ 一覧ビューを設定');

  await kintone('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  console.log('  ④ デプロイ中 …');
  await waitDeploy(app);

  console.log('\n完了 ✅  在庫アプリが本番に反映されました。');
  console.log(`   .env に次を設定してください →  KINTONE_INV_APP_ID=${app}`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
