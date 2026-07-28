// ============================================================
//  [調査ツール] 既存 Kintone アプリのフィールド構成を調べる
// ------------------------------------------------------------
//  新しくアプリを作る前に、"今あるアプリ" がどうなっているかを確認し、
//  このシステムが必要とするフィールドの過不足を洗い出します。
//
//  実行:
//    node kintone/inspectApp.js            … アプリ一覧を表示（要パスワード認証）
//    node kintone/inspectApp.js 6          … アプリID 6 のフィールドを表示
//
//  認証:
//    - 一覧表示 (/k/v1/apps.json) は APIトークンでは不可 → KINTONE_USER/PASSWORD が必要
//    - フィールド表示 (/k/v1/preview/app/form/fields.json) は APIトークンでも可
// ============================================================
import { required, optional } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

// このシステムが「日報アプリ」に期待しているフィールド（lib/normalize.js と対応）
const EXPECTED = {
  report_date: '報告日（日付）… 当日分の絞り込みに必須',
  reporter: '報告者',
  dept: '部署',
  planned_tasks: '本日予定していた業務',
  done_tasks: '本日完了した業務',
  completion_rate: '完了率（数値）',
  kpi_actual: '数値実績',
  undone_tasks: '未完了業務',
  undone_reason: '未完了理由',
  problems: '発生した問題・トラブル',
  requests_to_dept: '他部署への依頼',
  confirm_items: '社長・部長への確認事項',
  approval_request: '承認依頼',
  tomorrow_plan: '明日の予定',
  urgency: '緊急度（通常/要確認/緊急）… 即時通知の判定に必須',
  related_product: '関連商品',
  related_deal: '関連案件',
  submit_status: '提出状況（下書き/提出済み）… 集計対象の絞り込みに必須',
};

// 特にこれが無いと自動化が成立しない、というもの
const CRITICAL = ['report_date', 'urgency', 'submit_status'];

function baseUrl() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

// パスワード認証があればそれを、無ければAPIトークンを使う
function authHeaders() {
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (user && pass) {
    return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
  }
  const token =
    optional('KINTONE_API_TOKEN_DAILY_REPORT') ||
    optional('KINTONE_API_TOKEN_AI_REPORT') ||
    optional('KINTONE_API_TOKEN');
  if (token) return { 'X-Cybozu-API-Token': token };
  throw new Error(
    '認証情報がありません。KINTONE_USER + KINTONE_PASSWORD、または KINTONE_API_TOKEN_DAILY_REPORT を .env に設定してください。'
  );
}

async function call(path) {
  const res = await fetchWithRetry(
    `${baseUrl()}${path}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json', ...authHeaders() } },
    { label: `kintone GET ${path}` }
  );
  return res.json ?? {};
}

// ── アプリ一覧 ────────────────────────────────────────────
async function listApps() {
  const res = await call('/k/v1/apps.json?limit=100');
  const apps = res.apps ?? [];
  if (!apps.length) {
    console.log('表示できるアプリがありません（権限をご確認ください）。');
    return;
  }
  console.log(`\nアプリ一覧（${apps.length}件）\n`);
  for (const a of apps) {
    console.log(`  [ID ${String(a.appId).padStart(4)}]  ${a.name}`);
  }
  console.log('\n次にやること: 日報アプリのIDを指定して構成を確認');
  console.log('  node kintone/inspectApp.js <アプリID>');
}

// ── フィールド構成の表示＆過不足チェック ──────────────────
async function inspect(appId) {
  // preview 側を見ると「未反映の変更」も含めて確認できる
  const res = await call(`/k/v1/preview/app/form/fields.json?app=${encodeURIComponent(appId)}`);
  const props = res.properties ?? {};
  const codes = Object.keys(props).filter((c) => !c.startsWith('$'));

  console.log(`\n===== アプリ ID ${appId} のフィールド構成（${codes.length}件）=====\n`);
  console.log('  フィールドコード              | タイプ                | 表示名');
  console.log('  ' + '-'.repeat(76));
  for (const code of codes.sort()) {
    const f = props[code];
    const opts = f.options ? ` [${Object.keys(f.options).join('/')}]` : '';
    console.log(
      `  ${code.padEnd(28)}| ${String(f.type).padEnd(22)}| ${f.label ?? ''}${opts}`
    );
  }

  // ── 過不足チェック ──
  console.log('\n===== このシステムが必要とするフィールドの過不足 =====\n');
  const missing = [];
  for (const [code, desc] of Object.entries(EXPECTED)) {
    const has = code in props;
    const critical = CRITICAL.includes(code);
    const mark = has ? '✅ あり  ' : critical ? '❌ 不足★' : '⚠️  不足  ';
    if (!has) missing.push({ code, desc, critical });
    console.log(`  ${mark} ${code.padEnd(20)} ${desc}`);
  }

  if (!missing.length) {
    console.log('\n🎉 すべて揃っています。そのまま連携できます。');
    console.log(`   .env に KINTONE_DAILY_REPORT_APP_ID=${appId} を設定してください。`);
    return;
  }

  const criticalMissing = missing.filter((m) => m.critical);
  console.log(`\n不足: ${missing.length}件（うち★必須級: ${criticalMissing.length}件）`);
  if (criticalMissing.length) {
    console.log('\n★必須級が不足しています。これが無いと以下ができません:');
    for (const m of criticalMissing) console.log(`   - ${m.code}: ${m.desc}`);
  }
  console.log('\n対応方針は2つ:');
  console.log('  A) 既存アプリに不足フィールドを追加する（推奨・スタッフの入力習慣を変えない）');
  console.log('     → node kintone/addFields.js ' + appId + '   で追加できます');
  console.log('  B) 新しくアプリを作る');
  console.log('     → node kintone/createApps.js staff');
  console.log('\n※ 既存のフィールドコードが違う名前の場合は、lib/normalize.js の');
  console.log('   マッピングを実際のコードに合わせて修正してください。');
}

async function main() {
  const appId = process.argv[2];
  if (!appId) await listApps();
  else await inspect(appId);
}

main().catch((e) => {
  console.error('\nエラー:', e.message);
  if (String(e.message).includes('403') || String(e.message).includes('401')) {
    console.error('ヒント: APIトークンの権限、または「アプリを更新」での反映漏れをご確認ください。');
  }
  process.exit(1);
});
