// ============================================================
//  Shopify の注文エクスポートCSVを読む
// ------------------------------------------------------------
//  Shopify管理画面 →「注文管理」→「エクスポート」で出るCSVです。
//
//  ★このファイルのくせ
//    ① 1注文が複数行に分かれる（商品2点なら2行）
//    ② 2行目以降は「注文日」などの注文全体の情報が空になる
//       → 空欄をそのまま読むと、2行目以降が日付なしで捨てられます
//    ③ 金額は「1個あたりの単価」なので、数量を掛ける必要がある
//    ④ 見出しは日本語ストアでも英語（Lineitem name など）
//
//  ★金額の考え方（Amazon・楽天と揃えています）
//    ・売上 = 単価 × 数量 − その商品の割引
//    ・送料は含めません
//    ・キャンセルされた注文は数えません
//    ・テスト注文（Bogus Gateway）は数えません
//    ・返品は差し引きません（Amazonと同じ扱い。金額は別途表示します）
//
//  ★日本のストアは「税込価格」設定が普通なので、単価に税が入っています。
//    念のため、注文ごとの小計（Subtotal）と突き合わせて、
//    ずれていれば報告します（黙って合わせません）。
// ============================================================
import { readTable } from './csv.js';
import { parseAmount, parseDate } from './salesValues.js';

/** 注文全体の情報が入っている列（2行目以降は空になる） */
const ORDER_COLS = {
  createdAt: 'createdat',
  cancelledAt: 'cancelledat',
  financialStatus: 'financialstatus',
  paymentMethod: 'paymentmethod',
  subtotal: 'subtotal',
  refunded: 'refundedamount',
};

/** 商品1点ごとの列 */
const LINE_COLS = {
  name: 'lineitemname',
  sku: 'lineitemsku',
  qty: 'lineitemquantity',
  price: 'lineitemprice',
  discount: 'lineitemdiscount',
};

/** このファイルが Shopify の注文エクスポートかどうか */
export function looksLikeShopifyOrders(buf) {
  const { headers } = readTable(buf);
  return headers.includes('lineitemname') && headers.includes('name');
}

/** テスト注文かどうか（Shopifyの決済テストは Bogus Gateway で通る） */
export function isTestOrder(paymentMethod) {
  return /bogus/i.test(String(paymentMethod ?? ''));
}

/**
 * 注文CSVを読んで、明細の行にする。
 * @returns {{ok, reason?, encoding, rows, skipped, orders, refunded, subtotalGap}}
 */
export function readShopifyOrders(buf, opts = {}) {
  const { headers, rows, encoding } = readTable(buf);

  if (!headers.includes('lineitemname')) {
    return {
      ok: false,
      encoding,
      reason: `Shopifyの注文CSVではないようです。見出し: ${headers.slice(0, 10).join(' / ')}`,
      rows: [],
    };
  }

  // ── ① まず注文ごとの情報を集める（空欄を前の行から補う） ──
  const meta = new Map();
  for (const r of rows) {
    const key = String(r['name'] ?? '').trim();
    if (!key) continue;
    if (!meta.has(key)) meta.set(key, {});
    const m = meta.get(key);
    for (const [field, col] of Object.entries(ORDER_COLS)) {
      const v = String(r[col] ?? '').trim();
      if (v && m[field] === undefined) m[field] = v;
    }
  }

  // ── ② 商品1点ずつを明細にする ──
  const out = [];
  const skipped = { cancelled: 0, test: 0, noDate: 0, empty: 0 };
  const countedOrders = new Set();
  const cancelledOrders = new Set();
  const testOrders = new Set();
  let refunded = 0;
  const orderSum = new Map();

  for (const r of rows) {
    const key = String(r['name'] ?? '').trim();
    const m = meta.get(key) ?? {};

    if (m.cancelledAt) {
      if (!cancelledOrders.has(key)) { cancelledOrders.add(key); skipped.cancelled++; }
      continue;
    }
    if (isTestOrder(m.paymentMethod)) {
      if (!testOrders.has(key)) { testOrders.add(key); skipped.test++; }
      continue;
    }

    const title = String(r[LINE_COLS.name] ?? '').trim();
    if (!title) { skipped.empty++; continue; }

    // ★注文日は1行目にしか入っていないので、集めておいたものを使う
    const date = parseDate(m.createdAt);
    if (!date) { skipped.noDate++; continue; }

    const qty = parseAmount(r[LINE_COLS.qty]) ?? 0;
    const price = parseAmount(r[LINE_COLS.price]) ?? 0;
    const discount = parseAmount(r[LINE_COLS.discount]) ?? 0;
    // ★単価 × 数量。ここを掛け忘れると、まとめ買いの売上が1個ぶんになります。
    const amount = price * qty - discount;

    if (!qty && !amount) { skipped.empty++; continue; }

    countedOrders.add(key);
    orderSum.set(key, (orderSum.get(key) ?? 0) + amount);

    out.push({
      date,
      channel: opts.channel ?? '自社サイト',
      sku: String(r[LINE_COLS.sku] ?? '').trim(),
      asin: '',
      title,
      qty,
      amount,
      orderId: key,
    });
  }

  // 返品額（差し引きはしませんが、いくらあるかは出します）
  for (const key of countedOrders) {
    refunded += parseAmount(meta.get(key)?.refunded) ?? 0;
  }

  // ── ③ 注文ごとの小計と突き合わせる（税の設定違いに気づくため）──
  let subtotalGap = 0;
  let compared = 0;
  for (const [key, sum] of orderSum) {
    const sub = parseAmount(meta.get(key)?.subtotal);
    if (sub === null) continue;
    subtotalGap += sum - sub;
    compared++;
  }

  return {
    ok: true,
    encoding,
    headers,
    rows: out,
    skipped,
    orders: countedOrders.size,
    refunded,
    subtotalGap: compared ? subtotalGap : null,
    comparedOrders: compared,
  };
}

/** 小計とのズレをどう報告するか（黙って合わせない） */
export function describeSubtotalGap(result) {
  if (result.subtotalGap === null || !result.comparedOrders) return null;
  const total = result.rows.reduce((s, r) => s + r.amount, 0);
  if (total === 0) return null;
  const ratio = Math.abs(result.subtotalGap) / total;
  if (ratio < 0.005) return null; // 端数のズレは報告しない
  return (
    `注文の小計との差 ${Math.round(result.subtotalGap).toLocaleString('ja-JP')}円（${(ratio * 100).toFixed(1)}%）。` +
    'ストアの税設定（税込／税別）が想定と違う可能性があります。'
  );
}
