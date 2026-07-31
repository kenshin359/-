#!/usr/bin/env node
// ============================================================
//  楽天の商品ページURLから「レビュー用の商品ID」を調べる
// ------------------------------------------------------------
//  レビューページのURLは、商品ページのURLとは別の数字を使います。
//    商品ページ   https://item.rakuten.co.jp/libetee/suitcase01/
//    レビューページ https://review.rakuten.co.jp/item/1/407466_10000012/
//                                                      ↑この数字が必要
//
//  この数字は連番ではないため（10000012 の次が 10000032 だったりする）、
//  商品ページを開いて中から拾います。
//
//  実行:
//    npm run rakuten:items -- suitcase01 handyfan01 …
//    npm run rakuten:items -- --from-config     … 設定済みの商品を調べ直す
//
//  結果は config/rakuten-items.json に保存します。
//
//  ★楽天のサーバーには1.5秒以上あけてアクセスします。
//  ★ブラウザと同じ見出し（ヘッダー）を送らないと弾かれます。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optional, required } from '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(__dirname, '..', 'config', 'rakuten-items.json');
const DELAY_MS = 1500;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ★これだけ揃えないと楽天に弾かれます（42バイトのエラーページが返ります）
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 商品ページのURLから商品コード（末尾の英数字）を取り出す */
export function itemCodeFromUrl(url) {
  const m = String(url).match(/item\.rakuten\.co\.jp\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : String(url).trim();
}

/** 商品ページのHTMLから、レビュー用の商品IDと商品名を取り出す */
export function extractItemInfo(html) {
  const id =
    html.match(/"itemId"\s*:\s*(\d+)/)?.[1] ??
    html.match(/review\.rakuten\.co\.jp\/item\/1\/\d+_(\d+)/)?.[1] ??
    null;
  const title = html.match(/<title>([^<]*)/)?.[1]?.replace(/^【楽天市場】/, '').trim() ?? '';
  return { id, title };
}

async function fetchItemPage(shopCode, itemCode) {
  const url = `https://item.rakuten.co.jp/${shopCode}/${itemCode}/`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function load() {
  if (!fs.existsSync(CONFIG)) return { shop_code: 'libetee', items: [] };
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const cfg = load();
  const shopCode = optional('RAKUTEN_SHOP_CODE', cfg.shop_code || 'libetee');

  const codes = process.argv.includes('--from-config')
    ? cfg.items.map((i) => i.code)
    : args.map(itemCodeFromUrl);

  if (!codes.length) {
    console.log('使い方: npm run rakuten:items -- <商品ページURL または 商品コード> …');
    process.exit(1);
  }

  const byCode = new Map(cfg.items.map((i) => [i.code, i]));

  for (const [i, code] of codes.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    try {
      const { id, title } = extractItemInfo(await fetchItemPage(shopCode, code));
      if (!id) {
        console.warn(`  ⚠ ${code}: 商品IDが見つかりませんでした`);
        continue;
      }
      const prev = byCode.get(code) ?? {};
      byCode.set(code, { code, review_id: id, title: title.slice(0, 60), product: prev.product ?? '' });
      console.log(`  ✅ ${code} → ${id}`);
    } catch (e) {
      console.warn(`  ⚠ ${code}: ${e.message}`);
    }
  }

  const out = { shop_code: shopCode, items: [...byCode.values()] };
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\n保存しました: config/rakuten-items.json（${out.items.length}商品）`);
  console.log('RAKUTEN_ITEM_IDS は設定不要です。この一覧が自動で使われます。');
}

if (process.argv[1] && process.argv[1].endsWith('resolveRakutenItems.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
