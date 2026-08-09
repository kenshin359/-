// パッキングリスト（packing-lists/ 内の .xlsx / .xls）を読み込み、
// 物流スケジュールアプリへレコードとして投入（コンテナ番号で upsert）する。
//   - data/bl-info.json があれば、コンテナ番号をキーに BL/アライバル情報を補完
//   - 既に同じコンテナ番号のレコードがあれば更新、無ければ新規作成
//   実行: npm run import          （本投入）
//        DRY_RUN=1 npm run import  （投入せず out/preview.json に確認出力）
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kintone, qs } from './client.js';
import { parsePackingList } from './parsePackingList.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PL_DIR = process.env.PL_DIR || join(ROOT, 'packing-lists');
const BL_FILE = join(ROOT, 'data', 'bl-info.json');
const APP = process.env.KINTONE_LOGI_APP_ID;
const DRY = process.env.DRY_RUN === '1';

const v = (x) => ({ value: x == null || x === '' ? '' : String(x) });

function loadBlInfo() {
  if (!existsSync(BL_FILE)) return {};
  const raw = JSON.parse(readFileSync(BL_FILE, 'utf8'));
  delete raw._comment;
  return raw;
}

// パース結果 + BL補完 → 送信用の fields オブジェクト
function toFields(pl, bl) {
  const b = bl || {};
  const f = {
    shipping_date: v(pl.shipping_date),
    container_no: v(pl.container_no),
    seal_no: v(pl.seal_no),
    po_number: v(pl.po_number),
    container_type: v(b.container_type || pl.container_type),
    total_qty: v(pl.total_qty),
    gross_weight: v(pl.gross_weight),
    total_volume: v(pl.total_volume),
    // BL / アライバル（bl-info.json から補完）
    hbl_no: v(b.hbl_no),
    mbl_no: v(b.mbl_no),
    vessel: v(b.vessel),
    pol: v(b.pol),
    pod: v(b.pod),
    arrival_date: v(b.arrival_date),
    ref_no: v(b.ref_no),
    cargo_control_no: v(b.cargo_control_no),
    remarks: v(b.remarks),
    items: {
      value: pl.items.map((it) => ({
        value: {
          item_name: v(it.item_name),
          item_color: v(it.item_color),
          item_spec: v(it.item_spec),
          carton_size: v(it.carton_size),
          item_gw: v(it.item_gw),
          item_nw: v(it.item_nw),
          item_qty: v(it.item_qty),
          item_volume: v(it.item_volume),
        },
      })),
    },
  };
  if (b.bl_surrendered) f.bl_surrendered = v(b.bl_surrendered);
  if (b.total_cartons != null) f.total_cartons = v(b.total_cartons);
  // 空文字のドロップダウンは送らない（既定値／既存値を尊重）
  if (!f.container_type.value) delete f.container_type;
  return f;
}

// コンテナ番号 → 既存レコード$id のマップ
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
  if (!existsSync(PL_DIR)) throw new Error(`パッキングリストのフォルダがありません: ${PL_DIR}`);
  const files = readdirSync(PL_DIR).filter((n) => /\.(xlsx|xls)$/i.test(n) && !n.startsWith('~$'));
  if (!files.length) {
    console.log(`${PL_DIR} に .xlsx / .xls がありません。`);
    return;
  }

  const blInfo = loadBlInfo();
  console.log(`パッキングリスト ${files.length} 件を解析します（BL補完: ${Object.keys(blInfo).length} 件）\n`);

  const parsed = [];
  for (const name of files) {
    try {
      const pl = parsePackingList(join(PL_DIR, name));
      if (!pl.container_no) {
        console.warn(`  ⚠ ${name}: コンテナ番号を検出できずスキップ`);
        continue;
      }
      parsed.push({ name, pl, bl: blInfo[pl.container_no] });
      console.log(
        `  ✓ ${name} → ${pl.container_no} / 出荷 ${pl.shipping_date} / ${pl.items.length}品目 / ${pl.total_qty ?? '?'}個` +
          (blInfo[pl.container_no] ? '  [BL補完あり]' : '')
      );
    } catch (e) {
      console.warn(`  ⚠ ${name}: 解析失敗 (${e.message})`);
    }
  }
  if (!parsed.length) return;

  if (DRY) {
    mkdirSync(join(ROOT, 'out'), { recursive: true });
    const preview = parsed.map((p) => ({ file: p.name, ...toFields(p.pl, p.bl) }));
    writeFileSync(join(ROOT, 'out', 'preview.json'), JSON.stringify(preview, null, 2));
    console.log(`\n[DRY_RUN] 投入せず out/preview.json に書き出しました（${parsed.length}件）。`);
    return;
  }

  if (!APP) throw new Error('KINTONE_LOGI_APP_ID が未設定です（.env を確認）');
  const existing = await existingByContainer();

  let created = 0;
  let updated = 0;
  for (const { pl, bl } of parsed) {
    const record = toFields(pl, bl);
    const id = existing.get(pl.container_no);
    if (id) {
      await kintone('PUT', '/k/v1/record.json', { app: APP, id, record });
      updated++;
      console.log(`  ↻ 更新  ${pl.container_no} (id=${id})`);
    } else {
      const r = await kintone('POST', '/k/v1/record.json', { app: APP, record });
      existing.set(pl.container_no, r.id);
      created++;
      console.log(`  ＋ 新規  ${pl.container_no} (id=${r.id})`);
    }
  }
  console.log(`\n完了 ✅  新規 ${created} 件 / 更新 ${updated} 件を投入しました。`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
