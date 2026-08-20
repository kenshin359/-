// 発注データ（data/orders.json）を「発注管理」アプリへ投入（発注番号で upsert）。
//   実行: npm run import-orders
//        DRY_RUN=1 npm run import-orders   （投入せず out/orders-preview.json）
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kintone, qs } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FILE = join(ROOT, process.env.ORDERS_FILE || 'data/orders.json');
const APP = process.env.KINTONE_ORDER_APP_ID;
const DRY = process.env.DRY_RUN === '1';

const v = (x) => ({ value: x == null || x === '' ? '' : String(x) });

function toRecord(o) {
  const rec = {
    order_no: v(o.order_no),
    order_date: v(o.order_date),
    line: v(o.line),
    status: v(o.status),
    ship_plan: v(o.ship_plan),
    total_qty: v(o.total_qty),
    related_containers: v(o.related_containers),
    remarks: v(o.remarks),
    items: {
      value: (o.items || []).map((it) => ({
        value: {
          it_size: v(it.it_size),
          it_finish: v(it.it_finish),
          it_color: v(it.it_color),
          it_qty: v(it.it_qty),
        },
      })),
    },
  };
  if (!o.line) delete rec.line;
  if (!o.status) delete rec.status;
  return rec;
}

async function existingByOrder() {
  const map = new Map();
  let last = 0;
  for (;;) {
    const query = `$id > ${last} order by $id asc limit 100`;
    const r = await kintone(
      'GET',
      `/k/v1/records.json?${qs({ app: APP, query, 'fields[0]': '$id', 'fields[1]': 'order_no' })}`
    );
    const recs = r.records || [];
    if (!recs.length) break;
    for (const rec of recs) {
      const on = rec.order_no?.value;
      if (on) map.set(on, rec.$id.value);
    }
    last = Number(recs[recs.length - 1].$id.value);
    if (recs.length < 100) break;
  }
  return map;
}

async function main() {
  if (!existsSync(FILE)) throw new Error(`発注ファイルがありません: ${FILE}`);
  const orders = JSON.parse(readFileSync(FILE, 'utf8')).orders || [];
  if (!orders.length) return console.log('発注データがありません。');
  console.log(`発注 ${orders.length} 件を読み込みました。`);
  for (const o of orders) console.log(`  ${o.order_no}  ${o.line || ''}  ${o.total_qty ?? ''}個  [${o.status || ''}]`);

  if (DRY) {
    mkdirSync(join(ROOT, 'out'), { recursive: true });
    writeFileSync(join(ROOT, 'out', 'orders-preview.json'), JSON.stringify(orders.map(toRecord), null, 2));
    console.log(`\n[DRY_RUN] 投入せず out/orders-preview.json に書き出しました（${orders.length}件）。`);
    return;
  }

  if (!APP) throw new Error('KINTONE_ORDER_APP_ID が未設定です（.env を確認）');
  const existing = await existingByOrder();
  let created = 0;
  let updated = 0;
  for (const o of orders) {
    const record = toRecord(o);
    const id = existing.get(o.order_no);
    if (id) {
      await kintone('PUT', '/k/v1/record.json', { app: APP, id, record });
      updated++;
    } else {
      await kintone('POST', '/k/v1/record.json', { app: APP, record });
      created++;
    }
  }
  console.log(`\n完了 ✅  新規 ${created} / 更新 ${updated} 件を投入しました。`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
