// ============================================================
//  Shopify（自社サイト）の注文を読む
// ------------------------------------------------------------
//  Shopify の「Admin API」から注文を直接取ってきます。
//  CSVのダウンロードも、手作業も要りません。
//
//  ★なぜ GraphQL なのか
//    Shopify は昔ながらの REST API を「今後は新機能を足さない」方針に
//    変えました。長く使うものなので、GraphQL 側で作っています。
//
//  ★金額の考え方（Amazonと揃えています）
//    ・売上   = 商品の金額（割引を引いたあと）＋ その商品にかかる税
//    ・送料   は含めません（Amazonの item-price も送料を含まないため）
//    ・キャンセルされた注文は数えません
//    ・テスト注文（決済テスト）は数えません
//
//  ★計算はすべてこの JS 側で行います。AIには渡しません。
// ============================================================
import { optional, required } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

/** Shopify APIのバージョン。四半期ごとに新しくなります */
const DEFAULT_API_VERSION = '2026-01';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shopDomain() {
  // 「libetee.myshopify.com」の形。https:// は付けないでください
  return required('SHOPIFY_SHOP_DOMAIN')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

function adminToken() {
  return required('SHOPIFY_ADMIN_TOKEN');
}

export function endpoint() {
  const v = optional('SHOPIFY_API_VERSION', DEFAULT_API_VERSION);
  return `https://${shopDomain()}/admin/api/${v}/graphql.json`;
}

/**
 * GraphQL を1回投げる。
 *
 * ★Shopify は混み合うと「200 OK なのに中身がエラー」を返します。
 *   通信としては成功しているので、fetch のリトライでは拾えません。
 *   ここで中身を見て、混雑（THROTTLED）なら待って投げ直します。
 */
export async function shopifyGraphql(query, variables = {}, cfg = {}) {
  const maxThrottleRetries = cfg.maxThrottleRetries ?? 5;

  for (let attempt = 0; attempt <= maxThrottleRetries; attempt++) {
    const res = await fetchWithRetry(
      endpoint(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': adminToken(),
        },
        body: JSON.stringify({ query, variables }),
      },
      { label: 'shopify graphql' }
    );

    const json = res.json ?? {};
    const errors = json.errors ?? [];
    const throttled = errors.some((e) => e?.extensions?.code === 'THROTTLED');

    if (throttled && attempt < maxThrottleRetries) {
      const wait = 2000 * Math.pow(2, attempt);
      console.warn(`[shopify] 混み合っています。${wait}ms 待って投げ直します (${attempt + 1}/${maxThrottleRetries})`);
      await sleep(wait);
      continue;
    }
    if (errors.length) {
      const err = new Error(`Shopify が拒否しました: ${errors.map((e) => e.message).join(' / ')}`);
      err.body = json;
      throw err;
    }
    return json.data ?? {};
  }
  throw new Error('Shopify の混雑が解消しませんでした。時間をおいて実行してください。');
}

/** 期間の指定（Shopifyの検索の書き方）。日付は日本時間で指定します */
export function ordersQueryString(fromISO, toISO) {
  return `created_at:>='${fromISO}T00:00:00+09:00' created_at:<='${toISO}T23:59:59+09:00'`;
}

const ORDERS_QUERY = `
query Orders($q: String!, $cursor: String) {
  orders(first: 50, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      cancelledAt
      test
      taxesIncluded
      displayFinancialStatus
      lineItems(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          sku
          title
          quantity
          discountedTotalSet { shopMoney { amount } }
          taxLines { priceSet { shopMoney { amount } } }
        }
      }
    }
  }
}`;

/**
 * 期間内の注文をすべて取ってくる（ページをまたいで全部）。
 * @param {string} fromISO 'YYYY-MM-DD'（日本時間）
 * @param {string} toISO   'YYYY-MM-DD'（日本時間）
 */
export async function fetchOrders(fromISO, toISO, opts = {}) {
  const q = ordersQueryString(fromISO, toISO);
  const out = [];
  let cursor = null;
  let pages = 0;
  const maxPages = opts.maxPages ?? 200;

  do {
    const data = await shopifyGraphql(ORDERS_QUERY, { q, cursor });
    const conn = data.orders;
    if (!conn) break;
    out.push(...(conn.nodes ?? []));
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    pages++;
    if (pages >= maxPages) {
      console.warn(`[shopify] ページ数が上限(${maxPages})に達しました。期間を分けて実行してください。`);
      break;
    }
  } while (cursor);

  return out;
}

/** UTCの日時を、日本時間の 'YYYY-MM-DD' にする */
export function toLocalDate(iso, timeZone = optional('REPORT_TIMEZONE', 'Asia/Tokyo')) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 注文1件を、明細の行に開く。
 *
 * ★税の扱いに注意
 *   Shopifyの設定が「税込価格」なら、金額にすでに税が入っています。
 *   「税別価格」なら入っていないので、税を足さないと Amazon と比べられません。
 *   order.taxesIncluded を見て自動で切り替えます。
 */
export function orderToRows(order, opts = {}) {
  const channel = opts.channel ?? '自社サイト';
  const rows = [];
  const date = toLocalDate(order.createdAt, opts.timeZone);
  const taxIncluded = order.taxesIncluded === true;

  for (const li of order.lineItems?.nodes ?? []) {
    const base = money(li.discountedTotalSet?.shopMoney?.amount);
    const tax = (li.taxLines ?? []).reduce((s, t) => s + money(t.priceSet?.shopMoney?.amount), 0);
    rows.push({
      date,
      channel,
      sku: String(li.sku ?? '').trim(),
      asin: '',
      title: String(li.title ?? '').trim(),
      qty: Number(li.quantity) || 0,
      amount: taxIncluded ? base : base + tax,
      orderId: order.name || order.id,
    });
  }
  return rows;
}

/**
 * 注文の一覧を、明細の行の一覧にする。
 * 数えなかったものは skipped に理由つきで残します（黙って減らさないため）。
 */
export function ordersToRows(orders, opts = {}) {
  const rows = [];
  const skipped = { cancelled: 0, test: 0, empty: 0 };
  let truncatedLineItems = 0;

  for (const o of orders) {
    if (o.cancelledAt) { skipped.cancelled++; continue; }
    if (o.test) { skipped.test++; continue; }
    if (o.lineItems?.pageInfo?.hasNextPage) truncatedLineItems++;

    const r = orderToRows(o, opts);
    if (!r.length) { skipped.empty++; continue; }
    rows.push(...r);
  }

  return { rows, skipped, truncatedLineItems, orders: orders.length };
}
