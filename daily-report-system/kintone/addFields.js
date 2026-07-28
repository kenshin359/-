// ============================================================
//  [調整ツール] 既存の日報アプリに "不足しているフィールドだけ" 追加する
// ------------------------------------------------------------
//  既存アプリを作り直さず、自動化に必要なフィールドだけを足します。
//  すでにあるフィールドには一切触れません（既存データは安全）。
//
//  実行:
//    node kintone/addFields.js 6 --dry-run   … 何が追加されるか確認だけ（推奨・まずこれ）
//    node kintone/addFields.js 6             … 実際に追加してデプロイ
//    node kintone/addFields.js 6 --only=report_date,urgency,submit_status
//                                            … 指定したものだけ追加
//
//  ※ フィールド追加は管理操作のため KINTONE_USER + KINTONE_PASSWORD が必要です。
//    （追加が終わったら .env から消してかまいません）
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { FIELDS } from './staffReportSchema.js';

// 自動化に最低限必要なフィールド（迷ったらこれだけ追加すればよい）
const CRITICAL = ['report_date', 'urgency', 'submit_status'];

function baseUrl() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

function authHeaders() {
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'フィールド追加には KINTONE_USER と KINTONE_PASSWORD が必要です（.env に一時的に設定してください）。'
    );
  }
  return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
}

async function call(method, path, body) {
  const res = await fetchWithRetry(
    `${baseUrl()}${path}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    },
    { label: `kintone ${method} ${path}` }
  );
  return res.json ?? {};
}

async function waitDeploy(app) {
  for (let i = 0; i < 40; i++) {
    const r = await call('GET', `/k/v1/preview/app/deploy.json?apps[0]=${app}`);
    const status = r.apps?.[0]?.status;
    if (status === 'SUCCESS') return;
    if (status === 'FAIL' || status === 'CANCEL') throw new Error(`デプロイ失敗: ${status}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('デプロイがタイムアウトしました');
}

async function main() {
  const appId = process.argv[2];
  if (!appId) {
    console.error('使い方: node kintone/addFields.js <アプリID> [--dry-run] [--only=code1,code2]');
    console.error('アプリIDが分からない場合: node kintone/inspectApp.js');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;

  // 1) 現状のフィールドを取得
  const current = await call('GET', `/k/v1/preview/app/form/fields.json?app=${encodeURIComponent(appId)}`);
  const existing = new Set(Object.keys(current.properties ?? {}));
  console.log(`アプリ ID ${appId}: 既存フィールド ${existing.size} 件`);

  // 2) 追加候補を決める（既存にあるものは絶対に触らない）
  const toAdd = {};
  for (const [code, def] of Object.entries(FIELDS)) {
    if (existing.has(code)) continue;              // すでにある → スキップ
    if (only && !only.includes(code)) continue;    // --only 指定外 → スキップ
    // 報告者は既存の「氏名」等と重複しがちなので、明示指定が無い限り追加しない
    if (code === 'reporter' && !only) {
      console.log('  ⏭  reporter は既存の氏名フィールドと重複する可能性があるためスキップします');
      console.log('     （必要なら --only=reporter で追加、または lib/normalize.js を既存コードに合わせてください）');
      continue;
    }
    toAdd[code] = def;
  }

  const codes = Object.keys(toAdd);
  if (!codes.length) {
    console.log('\n✅ 追加が必要なフィールドはありません。');
    return;
  }

  console.log(`\n追加候補: ${codes.length} 件`);
  for (const code of codes) {
    const star = CRITICAL.includes(code) ? '★' : ' ';
    console.log(`  ${star} ${code.padEnd(20)} ${toAdd[code].label}  (${toAdd[code].type})`);
  }
  console.log('  ★ = 自動化に必須級');

  if (dryRun) {
    console.log('\n--dry-run のため、実際の追加は行いませんでした。');
    console.log('問題なければ --dry-run を外して再実行してください。');
    return;
  }

  // 3) 追加してデプロイ
  console.log('\nフィールドを追加しています…');
  await call('POST', '/k/v1/preview/app/form/fields.json', { app: appId, properties: toAdd });
  console.log('デプロイ中…（既存データはそのまま保持されます）');
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app: appId }] });
  await waitDeploy(appId);

  console.log('\n✅ 完了しました。');
  console.log(`   .env に KINTONE_DAILY_REPORT_APP_ID=${appId} を設定してください。`);
  console.log('   次: node kintone/inspectApp.js ' + appId + '  で過不足を再確認');
}

main().catch((e) => {
  console.error('\nエラー:', e.message);
  process.exit(1);
});
