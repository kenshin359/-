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
//    ・売上   = 商品単価 × 数量（税込）。送料・ラッピング代は含めません
//    ・キャンセル（進行状況800/900）は数えません
//    ・クーポン値引きは差し引きません（店舗データの「売上」と同じ考え方）
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
    for (const pkg of o.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const qty = Number(item.units) || 0;
        const price = Number(item.price) || 0;
        // SKU移行後の店舗は SkuModelList に「システム連携用SKU番号」が入る
        const skuFromVariant = (item.SkuModelList ?? [])
          .map((s) => s.merchantDefinedSkuId)
          .find((v) => v);
        rows.push({
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
  }
  return { rows, skipped };
}
