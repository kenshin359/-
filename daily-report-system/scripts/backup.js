// ============================================================
//  バックアップ（元データの丸ごと保存）
// ------------------------------------------------------------
//  Kintoneアプリの全レコードを、そのままの形でパソコンに保存します。
//  「何かあったときに元に戻せる」ようにするための保険です。
//
//  ※ このスクリプトは Kintone を一切変更しません。読み取るだけです。
//  ※ 読み取り権限だけで動きます（アプリ管理権限は不要）。
//
//  実行:
//    npm run backup                 … 日報アプリをバックアップ
//    npm run backup -- --app=7      … アプリID 7 をバックアップ
//    npm run backup -- --all        … .env に設定された全アプリ
//
//  保存先: backups/app<ID>-<日時>.json
//          （backups/ は .gitignore 済み。GitHubには上がりません）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { required, optional } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { authHeadersFor } from '../lib/kintone.js';
import { extractReports } from '../lib/extractReports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(__dirname, '..', 'backups');

function baseUrl() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

// ファイル名に使える日時文字列（2026-07-29_1530）
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** アプリの全レコードを取得（$idカーソルで全件） */
async function fetchAll(appId, headers) {
  const all = [];
  let lastId = 0;
  for (;;) {
    const query = `$id > ${lastId} order by $id asc limit 100`;
    const url = `${baseUrl()}/k/v1/records.json?app=${encodeURIComponent(appId)}&query=${encodeURIComponent(query)}`;
    const res = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json', ...headers } },
      { label: `backup app${appId}` }
    );
    const records = res.json?.records ?? [];
    if (!records.length) break;
    all.push(...records);
    lastId = Number(records[records.length - 1].$id.value);
    process.stdout.write(`\r  取得中… ${all.length} 件`);
    if (records.length < 100) break;
  }
  process.stdout.write('\r');
  return all;
}

/** アプリのフィールド定義も一緒に保存（構造の記録として重要） */
async function fetchFields(appId, headers) {
  try {
    const url = `${baseUrl()}/k/v1/app/form/fields.json?app=${encodeURIComponent(appId)}`;
    const res = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json', ...headers } },
      { label: `fields app${appId}`, retries: 1 }
    );
    return res.json?.properties ?? null;
  } catch {
    // 権限が無い場合は取れなくてもよい（レコードだけ保存する）
    return null;
  }
}

async function backupApp(appId, tokenKey) {
  const token = tokenKey ? optional(tokenKey) || null : null;
  const headers = authHeadersFor(token);

  console.log(`\n▶ アプリ ID ${appId} をバックアップします`);
  const records = await fetchAll(appId, headers);
  const fields = await fetchFields(appId, headers);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `app${appId}-${stamp()}.json`);

  const payload = {
    _meta: {
      backedUpAt: new Date().toISOString(),
      kintoneBaseUrl: baseUrl(),
      appId: String(appId),
      recordCount: records.length,
      note: 'Kintoneの生レコードをそのまま保存したものです。復元・確認に使えます。',
    },
    fields, // フィールド定義（取得できた場合）
    records, // 生レコード
  };

  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');

  const sizeKB = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ✅ ${records.length} 件を保存しました（${sizeKB} KB）`);
  console.log(`     ${file}`);

  // 日報として何件読めるかも参考表示（中身が空でないかの確認）
  const reports = extractReports(records);
  if (reports.length) {
    const dates = [...new Set(reports.map((r) => r.date).filter(Boolean))].sort();
    console.log(`     参考: 日報として ${reports.length} 件 / 期間 ${dates[0] ?? '?'} 〜 ${dates[dates.length - 1] ?? '?'}`);
  }
  return file;
}

async function main() {
  const appArg = process.argv.find((a) => a.startsWith('--app='));
  const all = process.argv.includes('--all');

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   Kintone バックアップ（読み取りのみ・変更しません）   ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  const targets = [];
  if (appArg) {
    targets.push({ id: appArg.slice('--app='.length), tokenKey: null });
  } else if (all) {
    const daily = optional('KINTONE_DAILY_REPORT_APP_ID');
    const ai = optional('KINTONE_AI_REPORT_APP_ID');
    if (daily) targets.push({ id: daily, tokenKey: 'KINTONE_API_TOKEN_DAILY_REPORT' });
    if (ai) targets.push({ id: ai, tokenKey: 'KINTONE_API_TOKEN_AI_REPORT' });
  } else {
    targets.push({ id: required('KINTONE_DAILY_REPORT_APP_ID'), tokenKey: 'KINTONE_API_TOKEN_DAILY_REPORT' });
  }

  if (!targets.length) {
    console.error('バックアップ対象がありません。--app=<ID> を指定するか .env を設定してください。');
    process.exit(1);
  }

  const files = [];
  for (const t of targets) files.push(await backupApp(t.id, t.tokenKey));

  console.log('\n──────────────────────────────────────────');
  console.log(`完了 ✅  ${files.length} 個のバックアップを作成しました。`);
  console.log('保存先フォルダ: backups/');
  console.log('※ このファイルには業務データが含まれます。取り扱いにご注意ください。');
  console.log('※ GitHubには上がりません（.gitignore 済み）。');
}

main().catch((e) => {
  console.error('\nバックアップ エラー:', e.message);
  process.exit(1);
});
