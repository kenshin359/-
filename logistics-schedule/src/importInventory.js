// 在庫CSV（data/inventory.csv）を「在庫」アプリへ投入（商品IDで upsert）。
//   実行: npm run import-inventory
//        DRY_RUN=1 npm run import-inventory   （投入せず out/inventory-preview.json）
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kintone, qs } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FILE = join(ROOT, process.env.INV_FILE || 'data/inventory.csv');
const APP = process.env.KINTONE_INV_APP_ID;
const DRY = process.env.DRY_RUN === '1';

const v = (x) => ({ value: x == null || x === '' ? '' : String(x) });

// ヘッダ（日本語ラベル）→ フィールドコード
const MAP = {
  商品ID: 'product_id',
  ライン: 'line',
  サイズ: 'size',
  色: 'color',
  仕上げ: 'finish',
  Amazon分: 'stock_amazon',
  良品在庫: 'stock_good',
  引当数: 'allocated',
  日販: 'daily_sales',
  発注点: 'reorder_point',
  在庫ステータス: 'stock_status',
  在庫日: 'snapshot_date',
};

// 素朴なCSVパーサ（値にカンマ・改行を含まない前提。BOM除去）
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const o = {};
    headers.forEach((h, i) => (o[h] = (cells[i] ?? '').trim()));
    return o;
  });
}

function toRecord(row) {
  const rec = {};
  for (const [label, code] of Object.entries(MAP)) {
    if (row[label] !== undefined && row[label] !== '') rec[code] = v(row[label]);
  }
  // stock_total は計算フィールドなので送らない
  return rec;
}

async function existingByProduct() {
  const map = new Map();
  let last = 0;
  for (;;) {
    const query = `$id > ${last} order by $id asc limit 100`;
    const r = await kintone(
      'GET',
      `/k/v1/records.json?${qs({ app: APP, query, 'fields[0]': '$id', 'fields[1]': 'product_id' })}`
    );
    const recs = r.records || [];
    if (!recs.length) break;
    for (const rec of recs) {
      const pid = rec.product_id?.value;
      if (pid) map.set(pid, rec.$id.value);
    }
    last = Number(recs[recs.length - 1].$id.value);
    if (recs.length < 100) break;
  }
  return map;
}

async function main() {
  if (!existsSync(FILE)) throw new Error(`在庫ファイルがありません: ${FILE}`);
  const rows = parseCsv(readFileSync(FILE, 'utf8'));
  if (!rows.length) return console.log('データがありません。');
  console.log(`在庫 ${rows.length} SKU を読み込みました。`);

  if (DRY) {
    mkdirSync(join(ROOT, 'out'), { recursive: true });
    writeFileSync(join(ROOT, 'out', 'inventory-preview.json'), JSON.stringify(rows.map(toRecord), null, 2));
    console.log(`\n[DRY_RUN] 投入せず out/inventory-preview.json に書き出しました（${rows.length}件）。`);
    return;
  }

  if (!APP) throw new Error('KINTONE_INV_APP_ID が未設定です（.env を確認）');
  const existing = await existingByProduct();
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const record = toRecord(row);
    const pid = row['商品ID'];
    const id = existing.get(pid);
    if (id) {
      await kintone('PUT', '/k/v1/record.json', { app: APP, id, record });
      updated++;
    } else {
      await kintone('POST', '/k/v1/record.json', { app: APP, record });
      created++;
    }
  }
  console.log(`\n完了 ✅  新規 ${created} / 更新 ${updated} SKU を投入しました。`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
