// レビューJSON抽出（__INITIAL_STATE__）のテスト。
// ★実在レビューはコミットしない（2-5）ため、構造だけ真似た合成データで検証します。
import test from "node:test";
import assert from "node:assert/strict";
import { parseReviews, extractInitialState } from "../src/rakuten/parseReviews.js";

// 実ページと同じ入れ子（reviews.data[uuid] + shopReviews.keys / itemReviews.keys）を作る
function buildHtml(state) {
  return `<!doctype html><html><head></head><body>
  <script>window.__INITIAL_STATE__ = ${JSON.stringify(state)};</script>
  </body></html>`;
}

const shopState = {
  itemInfo: {},
  reviews: {
    data: {
      "u1": { rating: 5, body: "対応が早くて良かったです。", nickname: "たろうさん", postDate: "2026/07/31" },
      "u2": { rating: 2, body: "届いてすぐ壊れました。", nickname: "はなこさん", postDate: "2026/07/30" },
    },
    shopReviews: { keys: ["u1", "u2"], count: 3622 },
    itemReviews: { keys: [], count: 0 },
  },
};

const itemState = {
  itemInfo: { itemId: 10000012, name: "スーツケース S/M/L Libetee" },
  reviews: {
    data: {
      "a1": { rating: 5, body: "静かで満足。", nickname: "みかさん", postDate: "2026/07/31", shopReply: "ありがとうございます。" },
      "a2": { rating: 4, body: "軽くて良い。", nickname: "けんさん", postDate: "2026/07/29" },
    },
    shopReviews: { keys: [], count: 0 },
    itemReviews: { keys: ["a1", "a2"], count: 4041 },
  },
};

test("extractInitialState: スクリプト内のJSONを取り出せる", () => {
  const s = extractInitialState(buildHtml(shopState));
  assert.ok(s && s.reviews && s.reviews.data);
});

test("ショップレビュー: rating(数値)・日付・本文・投稿者を正しく取る", () => {
  const { reviews, total } = parseReviews(buildHtml(shopState), { kind: "shop" });
  assert.equal(reviews.length, 2);
  assert.equal(total, 3622);
  assert.equal(reviews[0].rating, 5);
  assert.equal(reviews[0].date, "2026-07-31"); // /区切りを-に正規化
  assert.equal(reviews[0].author, "たろう"); // 「さん」を除去
  assert.equal(reviews[1].rating, 2);
  assert.equal(reviews[1].replied, false);
});

test("商品レビュー: 商品名(itemInfo.name)が取れる／shopReplyありは返信済み判定", () => {
  const { reviews, productName } = parseReviews(buildHtml(itemState), { kind: "item" });
  assert.equal(productName, "スーツケース S/M/L Libetee");
  const withReply = reviews.find((r) => r.body.includes("静か"));
  assert.equal(withReply.replied, true); // shopReply があるので返信済み
  const noReply = reviews.find((r) => r.body.includes("軽くて"));
  assert.equal(noReply.replied, false);
});

test("本文に商品名が混ざらない（JSONのbodyはレビュー本文のみ・5-3の問題が起きない）", () => {
  const { reviews } = parseReviews(buildHtml(itemState), { kind: "item" });
  assert.ok(!reviews[0].body.includes("Libetee"));
  assert.ok(!reviews[0].body.includes("スーツケース"));
});

test("__INITIAL_STATE__ が無ければ空でクラッシュしない", () => {
  const { reviews, source } = parseReviews("<html><body>no state</body></html>", { kind: "shop" });
  assert.deepEqual(reviews, []);
  assert.equal(source, "html");
});
