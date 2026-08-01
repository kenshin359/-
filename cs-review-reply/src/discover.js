// `npm run discover` … 楽天レビューサイトを走査して、このショップの商品を自動発見し
//   config/rakuten-items.json を更新します。
//
// ★なぜレビューサイトを見るのか（実測）：
//   商品ページ(item.rakuten.co.jp)や店舗トップ(www.rakuten.co.jp)は、実行環境によっては
//   Akamai のボット対策で弾かれる（42〜43バイトのエラーページ）ことがあります。
//   一方 review.rakuten.co.jp は取得でき、`window.__INITIAL_STATE__` に itemInfo が入っています。
//   そこで review.rakuten.co.jp/item/1/{shopId}_{reviewItemId}/ を範囲走査し、
//   itemInfo.name とレビュー件数がある reviewItemId を「商品」として拾います。
//
// 使い方:
//   npm run discover                 # 既定範囲(10000012〜10000080)を走査
//   npm run discover -- 10000012 10000120   # 範囲を指定
//
// ★楽天へは1.5秒以上あけてアクセス（fetch.js が担保）。範囲を広げすぎないこと。

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { fetchHtml } from "./rakuten/fetch.js";
import { extractInitialState } from "./rakuten/parseReviews.js";
import { say } from "./util/log.js";

// 商品名から category を推定（結びの出し分け用）
function guessCategory(name) {
  const n = name || "";
  if (/(スーツケース|キャリー|キャリーケース|キャリーバッグ|トランク|アルミスーツ)/.test(n)) return "suitcase";
  if (/(ハンディファン|扇風機|ファン|送風|首振り)/.test(n)) return "fan";
  if (/(ドライヤー|美顔|ヘアアイロン|脱毛|スチーマー|洗顔ブラシ|美容)/.test(n)) return "beauty";
  return "unknown";
}

// 長い販促タイトルから短い表示名をざっくり作る（先頭の【…】や記号を落とす）
function shortName(fullName) {
  let n = String(fullName || "").replace(/【[^】]*】/g, "").replace(/^[\s★☆・|]+/, "").trim();
  // 最初の全角/半角スペースまで、または30字までを表示名に
  n = n.split(/[\s　]/).slice(0, 4).join(" ");
  return n.slice(0, 30) || fullName.slice(0, 30);
}

async function main() {
  const cfg = loadConfig({ needSend: false });
  const shopId = cfg.rakuten.shopId;
  const start = parseInt(process.argv[2] || "10000012", 10);
  const end = parseInt(process.argv[3] || "10000080", 10);

  say(`▶ 商品の自動発見（shopId=${shopId} / reviewItemId ${start}〜${end}）`);
  say("  楽天へ1.5秒以上あけてアクセスします。範囲が広いと時間がかかります。");

  // 既存の対応表（category は手で直した値を尊重して残す）
  const existing = new Map((cfg.items.items || []).map((it) => [it.reviewItemId, it]));

  const found = [];
  for (let id = start; id <= end; id++) {
    const rid = String(id);
    const url = `https://review.rakuten.co.jp/item/1/${shopId}_${rid}/1.1/`;
    try {
      const html = await fetchHtml(url);
      const state = extractInitialState(html);
      const info = state && state.itemInfo;
      const count = state && state.reviews && state.reviews.itemReviews && state.reviews.itemReviews.count;
      if (info && info.name && count > 0) {
        const prev = existing.get(rid);
        const name = prev && prev.name ? prev.name : shortName(info.name);
        const category = prev && prev.category ? prev.category : guessCategory(info.name);
        found.push({ reviewItemId: rid, shopCode: cfg.rakuten.shopCode, name, category, pageUrl: url });
        say(`  ✅ ${rid}  レビュー${count}件  ${name}（${category}）`);
      }
    } catch (e) {
      say(`  ✗ ${rid}  ${String(e.message).slice(0, 40)}`);
    }
  }

  if (found.length === 0) {
    say("商品が見つかりませんでした。範囲やショップIDを確認してください。");
    return;
  }

  const out = { ...cfg.items, items: found };
  const path = join(ROOT, "config/rakuten-items.json");
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
  say(`\n${found.length}件の商品を config/rakuten-items.json に保存しました。`);
  say("※ category が unknown のものは、スーツケース類なら手で \"suitcase\" に直すと結びが最適化されます。");
}

main().catch((err) => {
  say("エラー: " + err.message);
  process.exit(1);
});
