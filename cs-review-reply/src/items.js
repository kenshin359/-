// `npm run items -- <商品ページURL>` … 監視する商品を追加する。
// ★落とし穴5-2：reviewItemId は商品ページから拾う（連番で探さない）。
//   拾った対応表は config/rakuten-items.json に保存し、
//   次からは「URLを渡すだけ」で追加できるようにします。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { resolveItem } from "./rakuten/resolveItemId.js";
import { say } from "./util/log.js";

// 商品名から category をざっくり推定（結びの出し分け用）。確信が持てなければ unknown。
function guessCategory(name) {
  const n = name || "";
  if (/(スーツケース|キャリー|キャリーケース|キャリーバッグ|トランク)/.test(n)) return "suitcase";
  if (/(ハンディファン|扇風機|ファン|送風)/.test(n)) return "fan";
  if (/(美容|ドライヤー|美顔|ヘアアイロン|脱毛|スチーマー)/.test(n)) return "beauty";
  return "unknown";
}

async function main() {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) {
    say("使い方: npm run items -- <商品ページURL>");
    say("例)     npm run items -- https://item.rakuten.co.jp/yourshop/abc123/");
    process.exit(1);
  }

  const cfg = loadConfig({ needSend: false });
  say(`商品ページを解析中... ${url}`);

  const resolved = await resolveItem(url, cfg.rakuten.shopId);
  const category = guessCategory(resolved.name);

  const items = cfg.items;
  items.items = items.items || [];

  // 既に同じ reviewItemId があれば更新、無ければ追加
  const existing = items.items.find((it) => it.reviewItemId === resolved.reviewItemId);
  const record = {
    reviewItemId: resolved.reviewItemId,
    shopCode: resolved.shopCode,
    name: resolved.name,
    category,
    pageUrl: resolved.pageUrl,
  };
  if (existing) {
    Object.assign(existing, record);
    say(`更新しました（既存）: ${resolved.name}`);
  } else {
    items.items.push(record);
    say(`追加しました: ${resolved.name}`);
  }

  const path = join(ROOT, "config/rakuten-items.json");
  writeFileSync(path, JSON.stringify(items, null, 2) + "\n", "utf8");

  say(`  reviewItemId: ${resolved.reviewItemId}`);
  say(`  category    : ${category}${category === "unknown" ? "（自動判定できず。結びは無難な『弊社商品』になります）" : ""}`);
  say(`保存先: config/rakuten-items.json`);
  if (category === "unknown") {
    say("※ 商品分類が unknown です。スーツケース類なら category を \"suitcase\" に手で直すと、キャリーケース向けの結びが使えます。");
  }
}

main().catch((err) => {
  say("エラー: " + err.message);
  process.exit(1);
});
