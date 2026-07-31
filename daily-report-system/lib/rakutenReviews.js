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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
      // 投稿者の属性（性別・年代）は本文ではない
      if (/^(男性|女性)$/.test(l) || /^\d+代(以上)?$/.test(l)) continue;
      // 購入用途のタグ（自分用｜プレゼント｜はじめて など）
      if (/^[^\s]{2,10}(｜[^\s]{2,10}){1,3}$/.test(l)) continue;
      body.push(l);
    }

    out.push({
      star: Number(lines[i]),
      date: lines[i + 1],
      who: lines[i + 2],
      shopReply,
      bodyLines: body,
      body: body.join(' ').trim(),
    });
  }
  return out;
}

/**
 * ページ内で繰り返し出てくる定型文（商品名など）を本文から取り除く。
 *
 * ★商品レビューのページでは、各レビューの前に商品名が入る。
 *   長い商品名がそのまま本文に混ざると、下書きの精度が落ちる。
 *   同じ長い行が3件以上のレビューに現れたら、それは本文ではなく
 *   ページの定型文とみなして落とす。
 */
/**
 * ページの商品名を取り出す。
 * レビューページの <title> は「【楽天市場】<商品名>(ショップ名) | みんなのレビュー…」の形。
 */
export function extractProductTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/);
  if (!m) return '';
  return m[1]
    .replace(/^【楽天市場】/, '')
    .replace(/\s*\|\s*みんなのレビュー.*$/, '')
    .replace(/\([^)]*\)\s*$/, '')
    .trim();
}

/**
 * 商品名の行を本文から取り除く。
 *
 * ★楽天の商品レビューでは、各レビューの前に商品名が入る。
 *   しかも「★4H限定2,000円OFF★」のような期間限定の文言が頭に付くため、
 *   同じ文字列の繰り返しとしては検出できない（毎回違う文字列になる）。
 *   そこでページの商品名から特徴語を取り出し、
 *   それを多く含む長い行を商品名とみなして落とす。
 */
export function stripProductTitle(rows, productTitle) {
  const tokens = String(productTitle || '')
    .split(/[\s　]+/)
    .map((s) => s.replace(/[【】★（）()]/g, '').trim())
    .filter((s) => s.length >= 3);
  if (tokens.length < 4) return rows;

  const looksLikeTitle = (line) => {
    if (line.length < 40) return false;
    const hits = tokens.filter((tk) => line.includes(tk)).length;
    return hits >= 4;
  };

  return rows.map((r) => {
    const lines = r.bodyLines ?? [];
    const kept = [];
    for (const l of lines) {
      if (!looksLikeTitle(l)) {
        kept.push(l);
        continue;
      }
      // 商品名の直後に感想が続いている場合があるので、末尾だけ残す
      // 例）「…出張 最高の質感！」→「最高の質感！」
      const tail = l.split(/[\s　]+/).slice(-1)[0];
      if (tail && tail.length >= 4 && !tokens.includes(tail)) kept.push(tail);
    }
    return { ...r, bodyLines: kept, body: kept.join(' ').trim() };
  });
}

export function stripBoilerplate(rows, minLen = 40, minRepeat = 3) {
  const count = new Map();
  for (const r of rows) {
    const lines = r.bodyLines ?? [];
    for (const l of new Set(lines)) {
      if (l.length >= minLen) count.set(l, (count.get(l) ?? 0) + 1);
    }
  }
  const boiler = new Set(
    [...count.entries()].filter(([, n]) => n >= minRepeat).map(([l]) => l)
  );
  if (!boiler.size) return rows;

  return rows.map((r) => {
    const kept = (r.bodyLines ?? []).filter((l) => !boiler.has(l));
    return { ...r, bodyLines: kept, body: kept.join(' ').trim() };
  });
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
    const html = await fetchHtml(itemReviewUrl(itemId, p));
    const rows = parseReviews(htmlToLines(html));
    if (!rows.length) break;
    // 商品名やページ共通の定型文を落としてから積む
    const cleaned = stripBoilerplate(stripProductTitle(rows, extractProductTitle(html)));
    all.push(...cleaned.map((r) => ({ ...r, source: `item:${itemId}` })));
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
  // ★まず config/rakuten-items.json を見ます。
  //   商品を増やすときは npm run rakuten:items -- <商品ページURL> を実行するだけで、
  //   .env を触る必要がありません。
  const fromConfig = itemsFromConfig().map((i) => i.review_id);
  if (fromConfig.length) return fromConfig;

  return optional('RAKUTEN_ITEM_IDS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 設定ファイルの商品一覧（レビューID・商品名つき）。無ければ空配列 */
export function itemsFromConfig() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', 'config', 'rakuten-items.json'), 'utf8');
    return (JSON.parse(raw).items ?? []).filter((i) => i.review_id);
  } catch {
    // 設定ファイルが無くても .env のほうで動けるようにする
    return [];
  }
}

/** レビューIDから商品名を引く（CSへの報告で「どの商品か」を出すため） */
export function productNameOf(reviewId) {
  return itemsFromConfig().find((i) => String(i.review_id) === String(reviewId))?.product ?? '';
}
