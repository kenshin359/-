#!/usr/bin/env node
// ============================================================
//  在庫報告アプリの添付CSVをテキストで取り出す（在庫Excel作成用）
// ------------------------------------------------------------
//  最新日の在庫報告（アプリ35）に添付されたCSVの中身をログに出します。
//  画像（スクショ）はサイズが大きいため対象外（ファイル名だけ出す）。
//  ★読むだけ・書き込みなし。数字は 0-9→A-J 置換（マスク対策・可逆）。
//
//  実行: node scripts/stockCsvDump.js --days=10
// ============================================================
import { optional } from '../lib/env.js';
import { authHeadersFor } from '../lib/kintone.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const LINE_WIDTH = 8000;

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const baseUrl = () => (optional('KINTONE_BASE_URL') || '').replace(/\/$/, '');
const enc = (s) => String(s).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);

function printChunked(s) {
  for (let i = 0; i < s.length; i += LINE_WIDTH) console.log(s.slice(i, i + LINE_WIDTH));
}

async function getJson(path) {
  const res = await fetchWithRetry(
    `${baseUrl()}${path}`,
    { method: 'GET', headers: authHeadersFor(null) },
    { label: `kintone GET ${path}` }
  );
  return res.json ?? {};
}

async function main() {
  const days = Number(arg('days', '10'));
  const app = arg('app', '') || optional('KINTONE_STOCK_REPORT_APP_ID') || '35';

  const since = new Date(Date.now() + 9 * 3600 * 1000);
  since.setUTCDate(since.getUTCDate() - days);
  const sinceISO = since.toISOString().slice(0, 10);

  const q = encodeURIComponent(`report_date >= "${sinceISO}" order by report_date desc limit 30`);
  const { records = [] } = await getJson(`/k/v1/records.json?app=${app}&query=${q}`);
  if (!records.length) {
    console.log(`直近${days}日の在庫報告がありません。`);
    return;
  }
  // 最新日のレコードだけを対象にする
  const latest = records[0].report_date?.value;
  const target = records.filter((r) => r.report_date?.value === latest);
  console.log(`最新日: ${enc(latest)} / レコード ${target.length}件`);

  for (const rec of target) {
    const memo = rec.memo?.value || '';
    for (const f of rec.file_stock?.value ?? []) {
      const isCsv = /\.csv$/i.test(f.name || '');
      console.log(`===FILE=== name=${enc(f.name)} memo=${enc(memo)} type=${isCsv ? 'csv' : 'skip'}`);
      if (!isCsv) continue;
      try {
        const url = `${baseUrl()}/k/v1/file.json?fileKey=${encodeURIComponent(f.fileKey)}`;
        const res = await fetch(url, { headers: authHeadersFor(null) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_FILE_BYTES) {
          console.log(`（${buf.length}バイト: 大きすぎるためスキップ）`);
          continue;
        }
        console.log('===CSV_B===');
        printChunked(enc(buf.toString('utf-8')));
        console.log('===CSV_END===');
      } catch (e) {
        console.log(`取得失敗: ${e.message}`);
      }
    }
  }
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
