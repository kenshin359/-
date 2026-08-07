// `npm run items -- <レビューURL または reviewItemId>` … 監視する商品を1つ追加する。
//
// ★このソフトはレビューサイト(review.rakuten.co.jp)から商品名・レビューを取ります。
//   商品ページ(item.rakuten.co.jp)は実行環境によってはボット対策で弾かれるため、
//   ここでも review.rakuten.co.jp を使って解決します（reviewItemId が分かればOK）。
//
// 使い方（どちらでも）:
//   npm run items -- https://review.rakuten.co.jp/item/1/407466_10000038/1.1/
//   npm run items -- 10000038
//
// 一括で発見したいときは `npm run discover` を使ってください。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { fetchHtml } from "./rakuten/fetch.js";
import { extractInitialState } from "./rakuten/parseReviews.js";
import { say } from "./util/log.js";

function guessCategory(name) {
  const n = name || "";
  if (/(スーツケース|キャリー|キャリーケース|キャリーバッグ|トランク|アルミスーツ)/.test(n)) return "suitcase";
  if (/(ハンディファン|扇風機|ファン|送風|首振り)/.test(n)) return "fan";
  if (/(ドライヤー|美顔|ヘアアイロン|脱毛|スチーマー|洗顔ブラシ|美容)/.test(n)) return "beauty";
  return "unknown";
}
function shortName(fullName) {
  let n = String(fullName || "").replace(/【[^】]*】/g, "").replace(/^[\s★☆・|]+/, "").trim();
  n = n.split(/[\s　]/).slice(0, 4).join(" ");
  return n.slice(0, 30) || String(fullName).slice(0, 30);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    say("使い方: npm run items -- <レビューURL または reviewItemId>");
    say("例)     npm run items -- https://review.rakuten.co.jp/item/1/407466_10000038/1.1/");
    say("例)     npm run items -- 10000038");
    say("（一括発見は npm run discover）");
    process.exit(1);
  }

  const cfg = loadConfig({ needSend: false });
  const shopId = cfg.rakuten.shopId;

  // 入力から reviewItemId を取り出す
  let reviewItemId = "";
  const m = String(arg).match(/(?:_|\/)(\d{6,})(?:\/|$)/) || String(arg).match(/^(\d{6,})$/);
  if (m) reviewItemId = m[1];
  if (!reviewItemId) {
    say(`エラー: 入力から reviewItemId（6桁以上の数字）を取り出せませんでした: ${arg}`);
    process.exit(1);
  }

  const url = `https://review.rakuten.co.jp/item/1/${shopId}_${reviewItemId}/1.1/`;
  say(`レビューページを解析中... ${url}`);
  const html = await fetchHtml(url);
  const state = extractInitialState(html);
  const info = state && state.itemInfo;
  if (!info || !info.name) {
    say(`エラー: この reviewItemId から商品情報を取得できませんでした（このショップの商品でない可能性）: ${reviewItemId}`);
    process.exit(1);
  }
  const category = guessCategory(info.name);
  const record = {
    reviewItemId,
    shopCode: cfg.rakuten.shopCode,
    name: shortName(info.name),
    category,
    pageUrl: url,
  };

  const items = cfg.items;
  items.items = items.items || [];
  const existing = items.items.find((it) => it.reviewItemId === reviewItemId);
  if (existing) {
    Object.assign(existing, record);
    say(`更新しました（既存）: ${record.name}`);
  } else {
    items.items.push(record);
    say(`追加しました: ${record.name}`);
  }

  writeFileSync(join(ROOT, "config/rakuten-items.json"), JSON.stringify(items, null, 2) + "\n", "utf8");
  say(`  reviewItemId: ${reviewItemId} / category: ${category}`);
  if (category === "unknown") {
    say("※ 商品分類が unknown です。スーツケース類なら category を \"suitcase\" に手で直すと結びが最適化されます。");
  }
}

main().catch((err) => {
  say("エラー: " + err.message);
  process.exit(1);
});
