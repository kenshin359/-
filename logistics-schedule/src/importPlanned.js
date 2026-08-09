// 発注（出荷計画）を物流スケジュールアプリへ「計画」ステータスのレコードとして登録する。
//   - data/planned-*.json（既定は planned-lm20260808.json）を読み込み
//   - container_no（仮キー LM20260808-01..13）で upsert（再実行しても重複しない）
//   - 実コンテナ番号が決まったら Kintone 上で container_no を書き換え、ステータスを進める
//   実行: npm run import-planned
//        DRY_RUN=1 npm run import-planned  （投入せず out/planned-preview.json に確認出力）
//        PLANNED_FILE=data/planned-xxx.json npm run import-planned  （別ファイル指定）
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kintone, qs } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FILE = join(ROOT, process.env.PLANNED_FILE || 'data/planned-lm20260808.json');
const APP = process.env.KINTONE_LOGI_APP_ID;
const DRY = process.env.DRY_RUN === '1';

const v = (x) => ({ value: x == null || x === '' ? '' : String(x) });

// 計画レコード → Kintone の fields
function toFields(r) {
  const f = {
    status: v(r.status || '計画'),
    shipping_date: v(r.shipping_date), // 出荷計画日（未定なら空）
    container_no: v(r.container_no), // 仮キー（割当後に更新）
    po_number: v(r.po_number || r.order_no),
    total_qty: v(r.total_qty),
    dray_status: v(r.dray_status || '未手配'),
    remarks: v(r.remarks),
    items: {
      value: (r.items || []).map((it) => ({
        value: {
          item_name: v(it.item_name),
          item_color: v(it.item_color),
          item_spec: v(it.item_spec),
          item_qty: v(it.item_qty),
        },
      })),
    },
  };
  // 任意項目（あるものだけ送る）
  if (r.arrival_date) f.arrival_date = v(r.arrival_date);
  if (r.customs_date) f.customs_date = v(r.customs_date);
  if (r.pol) f.pol = v(r.pol);
  if (r.pod) f.pod = v(r.pod);
  if (r.seal_no) f.seal_no = v(r.seal_no);
  if (r.container_type) f.container_type = v(r.container_type); // ドロップダウンの正規値のみ
  return f;
}

async function existingByContainer() {
  const map = new Map();
  let last = 0;
  for (;;) {
    const query = `$id > ${last} order by $id asc limit 100`;
    const r = await kintone(
      'GET',
      `/k/v1/records.json?${qs({ app: APP, query, 'fields[0]': '$id', 'fields[1]': 'container_no' })}`
    );
    const recs = r.records || [];
    if (!recs.length) break;
    for (const rec of recs) {
      const cn = rec.container_no?.value;
      if (cn) map.set(cn, rec.$id.value);
    }
    last = Number(recs[recs.length - 1].$id.value);
    if (recs.length < 100) break;
  }
  return map;
}

async function main() {
  if (!existsSync(FILE)) throw new Error(`計画ファイルがありません: ${FILE}`);
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  const records = data.records || [];
  if (!records.length) {
    console.log('レコードがありません。');
    return;
  }
  console.log(`発注 ${data.order_no || ''} の計画レコード ${records.length} 本（合計 ${data.total_qty} 個）を登録します。\n`);
  for (const r of records) {
    console.log(`  No.${r.seq}  ${r.container_no}  ${r.shipping_date}  ${r.size}サイズ  ${r.total_qty}個  [${r.status}]`);
  }

  if (DRY) {
    mkdirSync(join(ROOT, 'out'), { recursive: true });
    const preview = records.map((r) => ({ seq: r.seq, ...toFields(r) }));
    writeFileSync(join(ROOT, 'out', 'planned-preview.json'), JSON.stringify(preview, null, 2));
    console.log(`\n[DRY_RUN] 投入せず out/planned-preview.json に書き出しました（${records.length}本）。`);
    return;
  }

  if (!APP) throw new Error('KINTONE_LOGI_APP_ID が未設定です（.env を確認）');
  const existing = await existingByContainer();
  let created = 0;
  let updated = 0;
  for (const r of records) {
    const record = toFields(r);
    const id = existing.get(r.container_no);
    if (id) {
      await kintone('PUT', '/k/v1/record.json', { app: APP, id, record });
      updated++;
      console.log(`  ↻ 更新  ${r.container_no} (id=${id})`);
    } else {
      const res = await kintone('POST', '/k/v1/record.json', { app: APP, record });
      created++;
      console.log(`  ＋ 新規  ${r.container_no} (id=${res.id})`);
    }
  }
  console.log(`\n完了 ✅  新規 ${created} 本 / 更新 ${updated} 本を登録しました。`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
