// 「物流スケジュール」アプリを自動で作成する。
//   1. アプリの器を作成（プレビュー環境）
//   2. 仕様どおりのフィールドを追加
//   3. 一覧ビュー（出荷日・コンテナ番号・BL・アライバル・通関予定日・
//      ドレー手配状況・入庫日・発送可能日 …）を設定
//   4. 本番へデプロイ
// ※ アプリ作成はパスワード認証が必須（KINTONE_USER + KINTONE_PASSWORD）。
//   実行: npm run create-app
import { kintone, qs } from './client.js';
import { FIELDS, LIST_FIELDS } from './appSchema.js';

const NAME = process.env.KINTONE_LOGI_APP_NAME || '物流スケジュール';

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

// 一覧ビューを組み立てる（要望どおりの列・並び）
function buildViews() {
  return {
    物流スケジュール一覧: {
      type: 'LIST',
      name: '物流スケジュール一覧',
      index: '0',
      fields: LIST_FIELDS,
      sort: 'shipping_date desc',
    },
  };
}

async function main() {
  console.log(`アプリを作成します: 「${NAME}」`);

  const created = await kintone('POST', '/k/v1/preview/app.json', { name: NAME });
  const app = created.app;
  console.log(`  ① 器を作成 … app=${app}`);

  await kintone('POST', '/k/v1/preview/app/form/fields.json', { app, properties: FIELDS });
  console.log(`  ② フィールド ${Object.keys(FIELDS).length} 個を追加`);

  await kintone('PUT', '/k/v1/preview/app/views.json', { app, views: buildViews() });
  console.log('  ③ 一覧ビューを設定');

  await kintone('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  console.log('  ④ デプロイ中 …');
  await waitDeploy(app);

  console.log('\n完了 ✅  物流スケジュールアプリが本番に反映されました。');
  console.log(`   .env に次を設定してください →  KINTONE_LOGI_APP_ID=${app}`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
