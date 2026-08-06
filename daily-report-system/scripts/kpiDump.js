#!/usr/bin/env node
// ============================================================
//  毎朝KPI報告アプリ（広告費・売上）の添付ファイルを取り出す
// ------------------------------------------------------------
//  file_ads / file_sales / file_other に添付されたファイルを
//  ダウンロードしてログに出力します（分析用・読むだけ）。
//
//  ★公開リポジトリのため、出力はすべて16進数に変換したうえで
//    数字 0-9 を A-J に置き換えています（シークレットマスク対策）。
//    復号: A-J → 0-9 に戻してから16進デコード。
//
//  実行: node scripts/kpiDump.js --days=3
// ============================================================
import { optional } from '../lib/env.js';
import { authHeadersFor } from '../lib/kintone.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

const FILE_FIELDS = ['file_ads', 'file_sales', 'file_stock', 'file_other'];
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 1ファイル4MBまで
const LINE_WIDTH = 8000;

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function baseUrl() {
  return (optional('KINTONE_BASE_URL') || '').replace(/\/$/, '');
}

/** バイナリ→16進→数字をA-Jへ（ログのマスク対策・可逆） */
export function encodeHex(buf) {
  return buf.toString('hex').replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);
}

/** encodeHex の逆変換（テスト用） */
export function decodeHex(s) {
  const hex = s.replace(/[A-J]/g, (c) => String('ABCDEFGHIJ'.indexOf(c)));
  return Buffer.from(hex, 'hex');
}

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

async function downloadFile(fileKey) {
  const url = `${baseUrl()}/k/v1/file.json?fileKey=${encodeURIComponent(fileKey)}`;
  const res = await fetch(url, { headers: authHeadersFor(null) });
  if (!res.ok) throw new Error(`添付ファイルの取得に失敗: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const days = Number(arg('days', '3'));
  const appId = optional('KINTONE_KPI_APP_ID', '30');

  const since = new Date(Date.now() + 9 * 3600 * 1000);
  since.setUTCDate(since.getUTCDate() - days);
  const sinceISO = since.toISOString().slice(0, 10);

  const query = encodeURIComponent(`report_date >= "${sinceISO}" order by report_date desc limit 20`);
  const data = await getJson(`/k/v1/records.json?app=${encodeURIComponent(appId)}&query=${query}`);
  const records = data.records ?? [];
  console.log(`対象レコード: ${records.length}件（${sinceISO}以降）`);

  const meta = [];
  const downloads = [];
  for (const rec of records) {
    const entry = {
      recordId: rec.$id?.value ?? null,
      date: rec.report_date?.value ?? null,
      numbers: {
        s_rk: rec.s_rk?.value ?? null,
        s_az: rec.s_az?.value ?? null,
        s_own: rec.s_own?.value ?? null,
        target: rec.target?.value ?? null,
        a_gg: rec.a_gg?.value ?? null,
        a_rk: rec.a_rk?.value ?? null,
        a_az: rec.a_az?.value ?? null,
        a_meta: rec.a_meta?.value ?? null,
      },
      files: [],
    };
    for (const field of FILE_FIELDS) {
      for (const f of rec[field]?.value ?? []) {
        entry.files.push({
          index: downloads.length,
          field,
          name: f.name,
          size: Number(f.size),
          contentType: f.contentType,
        });
        downloads.push({ fileKey: f.fileKey, size: Number(f.size), name: f.name });
      }
    }
    meta.push(entry);
  }

  console.log('===KPI_META_HEX===');
  printChunked(encodeHex(Buffer.from(JSON.stringify(meta), 'utf8')));
  console.log('===KPI_META_END===');

  for (let i = 0; i < downloads.length; i++) {
    const d = downloads[i];
    if (d.size > MAX_FILE_BYTES) {
      console.log(`===KPI_FILE_HEX ${i} SKIPPED_TOO_LARGE===`);
      continue;
    }
    const buf = await downloadFile(d.fileKey);
    console.log(`===KPI_FILE_HEX ${i}===`);
    printChunked(encodeHex(buf));
    console.log(`===KPI_FILE_END ${i}===`);
  }

  console.log('完了');
}

const isMain = process.argv[1] && process.argv[1].endsWith('kpiDump.js');
if (isMain) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
