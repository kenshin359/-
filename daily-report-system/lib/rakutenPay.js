// ============================================================
//  楽天（RMS 楽天ペイ受注API）から注文を読む
// ------------------------------------------------------------
//  CSVのダウンロードも、手作業も要りません。
//  RMSの公式API（楽天ペイ受注API）から直接取ってきます。
//
//  ★流れ
//    ① searchOrder … 期間内の「注文番号の一覧」をもらう
//    ② getOrder   … 注文番号ごとの中身（商品・数量・金額）をもらう
//
//  ★金額の考え方（Amazon・Shopifyと揃えています）
//    ・売上   = 商品単価 × 数量（税込）− クーポン値引き（注文単位の値引きを
//               商品金額の比率で按分）。送料・ラッピング代は含めません
//    ・キャンセル（進行状況800/900）は数えません
//    ・つまり RMS「店舗売上」（クーポン適用後・税込）と一致する基準です
//
//  ★レート制限が厳しめ（1秒1回）なので、呼び出しの間に1秒待ちます。
// ============================================================
import { optional, required } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

const ENDPOINT = 'https://api.rms.rakuten.co.jp/es/2.0/order';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** RMS独自の認証ヘッダー（serviceSecret と licenseKey を合体させたもの） */
export function esaAuthHeader(
  serviceSecret = required('RAKUTEN_SERVICE_SECRET').trim(),
  licenseKey = required('RAKUTEN_LICENSE_KEY').trim()
) {
  return 'ESA ' + Buffer.from(`${serviceSecret}:${licenseKey}`).toString('base64');
}

async function call(path, body) {
  const res = await fetchWithRetry(
    `${ENDPOINT}${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: esaAuthHeader(),
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    },
    { label: `rakuten ${path}`, retries: 4 }
  );
  const json = res.json ?? {};
  // RMSは200でもエラーを中に入れて返すことがある
  const messages = json.MessageModelList ?? [];
  const fatal = messages.filter((m) => m.messageType === 'ERROR');
  if (fatal.length) {
    throw new Error(`楽天APIがエラーを返しました: ${fatal.map((m) => `${m.messageCode} ${m.message}`).join(' / ')}`);
  }
  return json;
}

/** 「2026-07-31」→「2026-07-31T00:00:00+0900」（RMSが求める形） */
export function rmsDatetime(dateISO, endOfDay = false) {
  return `${dateISO}T${endOfDay ? '23:59:59' : '00:00:00'}+0900`;
}

/** 期間内（注文日ベース）の注文番号を全部集める */
export async function searchOrderNumbers(fromISO, toISO) {
  const numbers = [];
  for (let page = 1; page <= 30; page++) {
    const r = await call('/searchOrder/', {
      dateType: 1, // 注文日
      startDatetime: rmsDatetime(fromISO),
      endDatetime: rmsDatetime(toISO, true),
      PaginationRequestModel: { requestRecordsAmount: 1000, requestPage: page },
    });
    const list = r.orderNumberList ?? [];
    numbers.push(...list);
    const pg = r.PaginationResponseModel;
    if (!pg || page >= (pg.totalPages ?? 1)) break;
    await sleep(1100);
  }
  return numbers;
}

/** 注文番号のかたまりごとに中身を取る（1回につき最大100件） */
export async function fetchOrders(fromISO, toISO) {
  const numbers = await searchOrderNumbers(fromISO, toISO);
  const orders = [];
  const version = Number(optional('RAKUTEN_ORDER_API_VERSION', '7'));
  for (let i = 0; i < numbers.length; i += 100) {
    if (i > 0) await sleep(1100);
    const r = await call('/getOrder/', {
      orderNumberList: numbers.slice(i, i + 100),
      version,
    });
    orders.push(...(r.OrderModelList ?? []));
  }
  return orders;
}

/** キャンセル系の進行状況（800=キャンセル確定待ち, 900=キャンセル確定） */
export function isCancelledProgress(orderProgress) {
  return Number(orderProgress) >= 800;
}

/**
 * 注文 → 明細行（aggregateByProduct に渡せる形）
 * @returns {{rows, skipped: {cancelled}}}
 */
export function ordersToRows(orders, opts = {}) {
  const channel = opts.channel ?? '楽天';
  const rows = [];
  const skipped = { cancelled: 0 };

  for (const o of orders) {
    if (isCancelledProgress(o.orderProgress)) {
      skipped.cancelled++;
      continue;
    }
    const date = String(o.orderDatetime ?? '').slice(0, 10);
    const orderRows = [];
    for (const pkg of o.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const qty = Number(item.units) || 0;
        const price = Number(item.price) || 0;
        // SKU移行後の店舗は SkuModelList に「システム連携用SKU番号」が入る
        const skuFromVariant = (item.SkuModelList ?? [])
          .map((s) => s.merchantDefinedSkuId)
          .find((v) => v);
        orderRows.push({
          date,
          channel,
          sku: String(skuFromVariant ?? item.itemNumber ?? item.manageNumber ?? '').trim(),
          asin: '',
          title: String(item.itemName ?? '').trim(),
          qty,
          amount: price * qty,
          orderId: String(o.orderNumber ?? ''),
        });
      }
    }
    applyCouponDiscount(orderRows, Number(o.couponAllTotalPrice) || 0);
    rows.push(...orderRows);
  }
  return { rows, skipped };
}

/**
 * 注文単位のクーポン値引きを、商品金額の比率で各行に按分して差し引く。
 * 端数は金額の大きい行から1円ずつ調整し、合計がぴったり値引き額になるようにする。
 * → 日別合計が RMS「店舗売上」（クーポン適用後）と一致する。
 */
export function applyCouponDiscount(orderRows, coupon) {
  if (!coupon || !orderRows.length) return;
  const total = orderRows.reduce((s, r) => s + r.amount, 0);
  if (total <= 0) return;
  const capped = Math.min(coupon, total);
  let allocated = 0;
  const shares = orderRows.map((r) => {
    const share = Math.floor((capped * r.amount) / total);
    allocated += share;
    return share;
  });
  // 端数（capped - allocated 円）を金額の大きい順に1円ずつ配る
  let rest = capped - allocated;
  const order = orderRows
    .map((r, i) => [r.amount, i])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length) {
    shares[order[k]] += 1;
    rest -= 1;
  }
  orderRows.forEach((r, i) => {
    r.amount -= shares[i];
  });
}
