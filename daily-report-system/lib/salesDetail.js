// ============================================================
//  売上レポートを読んで、商品ごとに紐づける
// ------------------------------------------------------------
//  Amazon のレポートは種類によって列名がまったく違います。
//    ・注文レポート       … 1行 = 1注文明細（purchase-date / sku / item-price …）
//    ・ビジネスレポート   … 1行 = 1商品1日（日付 /（子）ASIN / 注文商品売上 …）
//  どちらでも読めるようにしています。
//
//  ★商品の紐づけは3段階。確実な順に試します。
//    ① SKU が対応表にある      → 確定
//    ② ASIN が対応表にある     → 確定
//    ③ 商品名から推測          → 要確認（勝手に断定しない）
//
//  ★計算はすべてここ（JS側）で行います。AIは使いません。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readTable, normalizeHeader } from './csv.js';
import { parseAmount, parseDate } from './salesValues.js';
import { classifyProduct } from './adClassify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKU_MAP = join(HERE, '..', 'config', 'sku-map.json');

/** 列名の候補。上から順に探して最初に見つかったものを使う */
export const COLUMNS = {
  date: [
    'purchase-date', '購入日', '注文日', '日付', 'date', '日',
    'ordered date', 'payments-date', '発注日',
  ],
  sku: ['sku', '出品者sku', 'seller-sku', 'msku', '商品管理番号', '管理番号'],
  asin: ['asin', '(子)asin', '子asin', '(親)asin', '親asin', 'child asin', 'parent asin', 'product-id'],
  title: ['product-name', '商品名', 'title', 'タイトル', '商品タイトル'],
  qty: [
    'quantity-purchased', 'quantity', '数量', '個数', '注文された商品点数',
    'units ordered', '販売数', '注文商品点数',
  ],
  amount: [
    'item-price', '商品小計', '注文商品売上額', '注文商品売上', '売上', '売上金額',
    'ordered product sales', '注文額', 'itemprice', '金額',
  ],
  orderId: ['amazon-order-id', '注文番号', 'order-id', 'orderid'],
  // 返品・キャンセルを除くための状態列
  status: ['order-status', '注文ステータス', 'ステータス', 'item-status'],
};

let cachedMap = null;

/** SKU/ASIN の対応表を読む */
export function loadSkuMap(path = SKU_MAP) {
  if (cachedMap && path === SKU_MAP) return cachedMap;
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    json = { entries: [] };
  }
  const bySku = new Map();
  const byAsin = new Map();
  for (const e of json.entries ?? []) {
    if (!e.product) continue;
    if (e.sku) bySku.set(String(e.sku).trim().toUpperCase(), e.product);
    if (e.asin) byAsin.set(String(e.asin).trim().toUpperCase(), e.product);
  }
  const map = { bySku, byAsin, size: (json.entries ?? []).length };
  if (path === SKU_MAP) cachedMap = map;
  return map;
}

/** テスト用: 対応表を読み直せるようにする */
export function clearSkuMapCache() {
  cachedMap = null;
}

/** 見出しの一覧から欲しい列を探す（完全一致 → 部分一致） */
export function pickColumn(headers, candidates) {
  const norm = headers.map((h) => normalizeHeader(h));
  for (const c of candidates) {
    const i = norm.indexOf(normalizeHeader(c));
    if (i >= 0) return headers[i];
  }
  for (const c of candidates) {
    const key = normalizeHeader(c);
    const i = norm.findIndex((h) => h.includes(key));
    if (i >= 0) return headers[i];
  }
  return null;
}

/** 返品・キャンセルの行かどうか */
export function isCancelled(status) {
  const s = String(status ?? '').toLowerCase();
  if (!s) return false;
  return /cancel|キャンセル|返品|return|refund/.test(s);
}

/**
 * 1行を商品に紐づける。
 * @returns {{product, confidence, matchedBy}}
 */
export function mapProduct(row, skuMap = loadSkuMap()) {
  const sku = String(row.sku ?? '').trim().toUpperCase();
  const asin = String(row.asin ?? '').trim().toUpperCase();

  if (sku && skuMap.bySku.has(sku)) {
    return { product: skuMap.bySku.get(sku), confidence: '確定', matchedBy: 'SKU' };
  }
  if (asin && skuMap.byAsin.has(asin)) {
    return { product: skuMap.byAsin.get(asin), confidence: '確定', matchedBy: 'ASIN' };
  }

  // ★商品名からの推測。断定はせず、必ず「要確認」を付ける。
  //   対応表に1行足せば確定に変わります。
  const guess = classifyProduct(row.title ?? '');
  if (guess.product && guess.product !== '未分類') {
    return { product: guess.product, confidence: '要確認', matchedBy: '商品名から推測' };
  }
  return { product: '未分類', confidence: '要確認', matchedBy: null };
}

/**
 * 売上レポートを読む。
 *
 * @param {Buffer} buf ファイルの中身（バイト列のまま渡すこと）
 * @param {object} opts { channel, skipRows }
 */
export function readSalesReport(buf, opts = {}) {
  const { headers, rows, encoding } = readTable(buf, { skipRows: opts.skipRows ?? 0 });

  const col = {};
  for (const [key, candidates] of Object.entries(COLUMNS)) {
    col[key] = pickColumn(headers, candidates);
  }

  const missing = [];
  if (!col.date) missing.push('日付');
  if (!col.amount && !col.qty) missing.push('売上または数量');
  if (missing.length) {
    return {
      ok: false,
      encoding,
      headers,
      reason: `必要な列が見つかりません（${missing.join(' / ')}）。見出し: ${headers.slice(0, 12).join(' / ')}`,
    };
  }

  const out = [];
  const skipped = { cancelled: 0, noDate: 0, empty: 0 };

  for (const r of rows) {
    if (col.status && isCancelled(r[col.status])) { skipped.cancelled++; continue; }

    const date = parseDate(r[col.date]);
    if (!date) { skipped.noDate++; continue; }

    const qty = col.qty ? parseAmount(r[col.qty]) : null;
    const amount = col.amount ? parseAmount(r[col.amount]) : null;
    if (!qty && !amount) { skipped.empty++; continue; }

    out.push({
      date,
      channel: opts.channel ?? 'Amazon',
      sku: col.sku ? String(r[col.sku] ?? '').trim() : '',
      asin: col.asin ? String(r[col.asin] ?? '').trim() : '',
      title: col.title ? String(r[col.title] ?? '').trim() : '',
      qty: qty ?? 0,
      amount: amount ?? 0,
      orderId: col.orderId ? String(r[col.orderId] ?? '').trim() : '',
    });
  }

  return {
    ok: true,
    encoding,
    headers,
    usedColumns: col,
    rows: out,
    skipped,
    // 1つの注文が複数行に分かれるレポートかどうか（注文数の数え方が変わる）
    hasOrderId: !!col.orderId,
  };
}

/**
 * 日 × 販売先 × 商品 でまとめる。
 * ★日付をまたいで商品名だけで束ねると、全期間の合計が
 *   その商品が最初に出てきた日の売上になってしまうため、日付も鍵に含めます。
 */
export function aggregateByProduct(rows, skuMap = loadSkuMap()) {
  const byKey = new Map();
  const unmapped = new Map();

  for (const r of rows) {
    const m = mapProduct(r, skuMap);
    const key = `${r.date}__${r.channel}__${m.product}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        date: r.date,
        channel: r.channel,
        product: m.product,
        confidence: m.confidence,
        matchedBy: m.matchedBy,
        sku: r.sku,
        asin: r.asin,
        title: r.title,
        qty: 0,
        amount: 0,
        orderIds: new Set(),
      });
    }
    const b = byKey.get(key);
    b.qty += r.qty;
    b.amount += r.amount;
    if (r.orderId) b.orderIds.add(r.orderId);
    // 同じ商品に複数SKUがぶら下がる場合、最初のものを代表として残す
    if (!b.sku && r.sku) b.sku = r.sku;
    if (!b.asin && r.asin) b.asin = r.asin;

    if (m.confidence !== '確定') {
      const uk = r.sku || r.asin || r.title || '(不明)';
      if (!unmapped.has(uk)) {
        unmapped.set(uk, { sku: r.sku, asin: r.asin, title: r.title, qty: 0, amount: 0, guess: m.product });
      }
      const u = unmapped.get(uk);
      u.qty += r.qty;
      u.amount += r.amount;
    }
  }

  const list = [...byKey.values()].map((b) => ({
    ...b,
    orders: b.orderIds.size || null,
    orderIds: undefined,
  }));
  list.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  return {
    rows: list,
    unmapped: [...unmapped.values()].sort((a, b) => b.amount - a.amount),
    dates: [...new Set(list.map((r) => r.date))].sort(),
  };
}
