// ★★落とし穴5-2（実測済み）★★
//   reviewItemId は、商品ページURLの英字コードとは“別物の数字”。しかも連番でない。
//   （ある商品が 10000012、次が 10000032、その次が 10000048 …）
//   → 順番に試す方式はほぼ当たらない。商品ページのHTMLから拾うのが正解。
//
// 取り方（どちらかで拾える）：
//   (a) HTML内の "itemId":10000038 の形
//   (b) review.rakuten.co.jp/item/1/{shopId}_(数字) のリンク
import { fetchHtml } from "./fetch.js";

// 商品ページの<title>から商品名を取り出す（5-3の商品名除去にも使う）
export function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  // 楽天のtitleは「商品名｜ショップ名」等。区切りの前を商品名とみなす。
  return m[1]
    .replace(/&amp;/g, "&")
    .split(/[|｜\-–—:：]/)[0]
    .trim();
}

// 商品ページHTMLから reviewItemId（数字）を拾う。shopId は絞り込みに使う。
export function extractReviewItemId(html, shopId) {
  // (a) "itemId":10000038
  const a = html.match(/"itemId"\s*:\s*"?(\d{6,})"?/);
  if (a) return a[1];

  // (b) review.rakuten.co.jp/item/1/{shopId}_(数字)
  if (shopId) {
    const re = new RegExp(`review\\.rakuten\\.co\\.jp/item/1/${shopId}_(\\d{6,})`);
    const b = html.match(re);
    if (b) return b[1];
  }
  // shopId 不明でも item リンクがあれば拾う
  const c = html.match(/review\.rakuten\.co\.jp\/item\/1\/\d+_(\d{6,})/);
  if (c) return c[1];

  return null;
}

// 商品ページURLから { reviewItemId, name, shopCode } を解決する。
// URL例）https://item.rakuten.co.jp/{shopCode}/{itemCode}/
export async function resolveItem(pageUrl, shopId) {
  const html = await fetchHtml(pageUrl);
  const reviewItemId = extractReviewItemId(html, shopId);
  const name = extractTitle(html);
  // URLから shopCode を拾う
  const scMatch = pageUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\//);
  const shopCode = scMatch ? scMatch[1] : "";

  if (!reviewItemId) {
    throw new Error(
      `商品ページから reviewItemId を見つけられませんでした: ${pageUrl}\n` +
        `（ページ構成が変わった可能性。resolveItemId.js の拾い方を見直してください）`
    );
  }
  return { reviewItemId, name, shopCode, pageUrl };
}
