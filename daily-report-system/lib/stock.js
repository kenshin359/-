// ============================================================
//  在庫の読み取りと、気づきの組み立て
// ------------------------------------------------------------
//  「今日の在庫が入っているか」だけでなく、
//  「どの商品が危ないか」まで出します。
//
//  ★計算はすべてここ（JS側）で行います。AIは使いません。
// ============================================================
import { flattenDetail, slotStatus, dedupKey } from '../kintone/inventorySchema.js';
import { call } from './intake.js';
import { optional } from './env.js';

export function inventoryAppId() {
  const id = optional('KINTONE_INVENTORY_APP_ID');
  if (!id) {
    throw new Error(
      'KINTONE_INVENTORY_APP_ID が未設定です。\n' +
        '  `npm run create-business-apps inventory` で作成し、表示された行を .env に貼ってください。'
    );
  }
  return id;
}

/** ある日のレコードを取る（無ければ null） */
export async function findSnapshot(dateISO, app = inventoryAppId()) {
  const q = encodeURIComponent(`dedup_key = "${dedupKey(dateISO)}" limit 1`);
  const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
  return r.records?.[0] ?? null;
}

/** その日以前で、いちばん新しい「前回」のレコードを取る */
export async function findPrevious(dateISO, app = inventoryAppId()) {
  const q = encodeURIComponent(
    `snapshot_date < "${dateISO}" order by snapshot_date desc limit 1`
  );
  const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
  return r.records?.[0] ?? null;
}

/** 在庫の少なさで並べるときのしきい値（既定） */
export const LOW_STOCK = 10;

/**
 * 在庫の状況をまとめる。
 *
 * ★ここが Amazon と CS を分けている意味が出るところです。
 *   合計だけ見ていると「在庫はあるのに楽天で売れない」に気づけません。
 */
export function analyzeStock(record, prevRecord = null, opts = {}) {
  const low = opts.low ?? LOW_STOCK;
  const rows = flattenDetail(record);
  const prevRows = flattenDetail(prevRecord);
  const prevBy = new Map(prevRows.map((r) => [r.product, r]));

  const totals = rows.reduce(
    (a, r) => ({ amazon: a.amazon + r.amazon, cs: a.cs + r.cs, all: a.all + r.total }),
    { amazon: 0, cs: 0, all: 0 }
  );

  // 欠品（両方0）
  const out = rows.filter((r) => r.total === 0);
  // 残りわずか（0ではないが少ない）
  const few = rows.filter((r) => r.total > 0 && r.total <= low);

  // ★FBA切れ: Amazonが0なのに、CSには在庫がある
  //   → Amazonでは売れないが、楽天・自社では売れる状態。補充すれば売上になる。
  const needFbaRestock = rows.filter((r) => r.amazon === 0 && r.cs > 0);

  // ★CS切れ: CSが0なのに、Amazonには在庫がある
  //   → 楽天・自社サイトの注文が出せない状態。
  const needCsRestock = rows.filter((r) => r.cs === 0 && r.amazon > 0);

  // 前回からの減り方（急に減った商品）
  const drops = [];
  for (const r of rows) {
    const p = prevBy.get(r.product);
    if (!p || p.total <= 0) continue;
    const diff = r.total - p.total;
    const pct = (diff / p.total) * 100;
    if (diff < 0) drops.push({ ...r, prevTotal: p.total, diff, pct });
  }
  drops.sort((a, b) => a.pct - b.pct);

  return {
    date: record?.snapshot_date?.value ?? null,
    prevDate: prevRecord?.snapshot_date?.value ?? null,
    rows,
    totals,
    out,
    few,
    needFbaRestock,
    needCsRestock,
    drops,
    slots: slotStatus(record ?? {}),
    low,
  };
}

const n = (v) => Number(v).toLocaleString('ja-JP');

/** 報告文（Chatwork / 画面用） */
export function formatStockReport(a, opts = {}) {
  const { title = '在庫レポート' } = opts;
  const L = [];

  L.push(`📦 ${title}（${a.date ?? '—'}）`);
  L.push('');
  L.push(`総在庫　${n(a.totals.all)}個`);
  L.push(`　Amazon(FBA) ${n(a.totals.amazon)}個 ／ CS(倉庫＋事務所) ${n(a.totals.cs)}個`);
  L.push(`　登録商品　${a.rows.length}件`);

  const missingFiles = a.slots.filter((s) => !s.filled);
  if (missingFiles.length) {
    L.push('');
    L.push('【元ファイル未添付】');
    for (const s of missingFiles) L.push(`　⬜ ${s.label}`);
  }

  if (a.out.length) {
    L.push('');
    L.push(`【欠品】${a.out.length}件 ⚠️`);
    for (const r of a.out) L.push(`　・${r.product}`);
  }

  if (a.few.length) {
    L.push('');
    L.push(`【残りわずか（${a.low}個以下）】${a.few.length}件`);
    for (const r of a.few) L.push(`　・${r.product}　${n(r.total)}個（Amazon ${n(r.amazon)} / CS ${n(r.cs)}）`);
  }

  // ★合計だけ見ていると気づけない、いちばん大事な2つ
  if (a.needFbaRestock.length) {
    L.push('');
    L.push('【Amazon倉庫が空です】FBAへ送れば売れる状態です');
    for (const r of a.needFbaRestock) L.push(`　・${r.product}　CSに ${n(r.cs)}個あり`);
  }
  if (a.needCsRestock.length) {
    L.push('');
    L.push('【CS在庫が空です】楽天・自社の注文が出せません');
    for (const r of a.needCsRestock) L.push(`　・${r.product}　Amazonに ${n(r.amazon)}個あり`);
  }

  if (a.drops.length) {
    const big = a.drops.filter((d) => d.pct <= -20).slice(0, 5);
    if (big.length) {
      L.push('');
      L.push(`【前回より大きく減った商品】（前回 ${a.prevDate ?? '—'}）`);
      for (const d of big) {
        L.push(`　・${d.product}　${n(d.prevTotal)} → ${n(d.total)}個（${d.pct.toFixed(0)}%）`);
      }
    }
  }

  if (!a.out.length && !a.few.length && !a.needFbaRestock.length && !a.needCsRestock.length) {
    L.push('');
    L.push('✅ 欠品・残りわずかの商品はありません。');
  }

  return L.join('\n');
}
