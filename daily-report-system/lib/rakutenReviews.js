// ============================================================
//  楽天のレビューページを読む
// ------------------------------------------------------------
//  楽天にはレビュー返信のAPIがありません（RMSの管理画面から手動）。
//  レビューの取得APIも公開されていないため、
//  公開されているレビューページを読み取ります。
//
//  ★取得するのは自社ショップのレビューだけです。
//  ★負荷をかけないよう、1ページずつ間隔を空けて取得します。
//
//  設定（.env）:
//    RAKUTEN_SHOP_CODE   … 例: libetee
//    RAKUTEN_SHOP_ID     … 例: 407466（レビューURLの数字）
//    RAKUTEN_ITEM_IDS    … 例: 10000012,10000015（カンマ区切り・任意）
// ============================================================
import { optional } from './env.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const BASE = 'https://review.rakuten.co.jp';

/** ページ取得の間隔（ミリ秒）。楽天に負荷をかけないため */
const POLITE_DELAY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function shopId() {
  return optional('RAKUTEN_SHOP_ID', '');
}

/** ショップレビューのURL */
export function shopReviewUrl(page = 1) {
  const id = shopId();
  if (!id) throw new Error('RAKUTEN_SHOP_ID が未設定です（レビューURLの数字部分）');
  return `${BASE}/shop/4/${id}_${id}/${page}.1/`;
}

/** 商品レビューのURL */
export function itemReviewUrl(itemId, page = 1) {
  const id = shopId();
  if (!id) throw new Error('RAKUTEN_SHOP_ID が未設定です');
  return `${BASE}/item/1/${id}_${itemId}/${page}.1/`;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`レビューページの取得に失敗しました (${res.status}) ${url}`);
  return await res.text();
}

/** HTMLを行の配列にする */
export function htmlToLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 「★」「日付」「〜さん」の並びを目印にレビューを切り出す */
export function parseReviews(lines) {
  const out = [];
  const isHead = (i) =>
    /^[1-5]$/.test(lines[i]) &&
    /^20\d\d\/\d{1,2}\/\d{1,2}$/.test(lines[i + 1] ?? '') &&
    /さん$/.test(lines[i + 2] ?? '');

  for (let i = 0; i < lines.length; i++) {
    if (!isHead(i)) continue;

    const body = [];
    let shopReply = false;
    for (let j = i + 3; j < lines.length; j++) {
      const l = lines[j];
      if (l === '不適切レビュー報告') break;
      if (l === 'ショップからのコメント') {
        shopReply = true;
        break;
      }
      if (isHead(j)) break;
      // 表示上のボタン類は本文ではない
      if (/^(さらに表示|参考になった|カラー:|注文日：)/.test(l)) continue;
      if (/^\d+人$/.test(l) || l === 'が参考になったと回答') continue;
      body.push(l);
    }

    out.push({
      star: Number(lines[i]),
      date: lines[i + 1],
      who: lines[i + 2],
      shopReply,
      body: body.join(' ').trim(),
    });
  }
  return out;
}

/** 同じレビューを二重に扱わないためのキー */
export function reviewKey(r) {
  return `${r.date}__${r.who}__${r.body.slice(0, 40)}`;
}

/**
 * ショップレビューを新しい順に取得する。
 * @param {number} pages 取得ページ数（1ページ30件）
 */
export async function fetchShopReviews(pages = 2) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    if (p > 1) await sleep(POLITE_DELAY_MS);
    const rows = parseReviews(htmlToLines(await fetchHtml(shopReviewUrl(p))));
    if (!rows.length) break;
    all.push(...rows.map((r) => ({ ...r, source: 'shop' })));
  }
  return dedupe(all);
}

/** 商品レビューを取得する */
export async function fetchItemReviews(itemId, pages = 2) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    if (p > 1) await sleep(POLITE_DELAY_MS);
    const rows = parseReviews(htmlToLines(await fetchHtml(itemReviewUrl(itemId, p))));
    if (!rows.length) break;
    all.push(...rows.map((r) => ({ ...r, source: `item:${itemId}` })));
  }
  return dedupe(all);
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = reviewKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 設定に書かれた商品IDの一覧 */
export function configuredItemIds() {
  return optional('RAKUTEN_ITEM_IDS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
