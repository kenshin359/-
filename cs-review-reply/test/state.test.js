// 送信済み記録のテスト。8. の 10 を確認します。
// ★お客様情報（レビュー本文・投稿者名）が記録に残っていないこと。
import test from "node:test";
import assert from "node:assert/strict";
import { reviewHash } from "../src/util/hash.js";

test("8-10: 送信済みの記録（ハッシュ）に、レビュー本文・投稿者名が残っていない", () => {
  const review = {
    kind: "item",
    itemId: "10000038",
    author: "山田太郎",
    date: "2026-07-31",
    rating: 2,
    body: "届いてすぐ壊れました。とても困っています。連絡先: 090-xxxx-xxxx",
  };
  const h = reviewHash(review);

  // ハッシュは16進の固定長。元テキストの断片を含まない。
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes("山田"), "投稿者名が残っている");
  assert.ok(!h.includes("壊れ"), "本文が残っている");
  assert.ok(!h.includes("090"), "本文（電話番号）が残っている");
});

test("同じレビューは同じハッシュ（重複送信を防げる）", () => {
  const r = { kind: "shop", itemId: "", author: "A", date: "2026-07-31", rating: 5, body: "良い" };
  assert.equal(reviewHash(r), reviewHash({ ...r }));
});

test("本文が違えば別ハッシュ（別レビューとして扱える）", () => {
  const base = { kind: "shop", itemId: "", author: "A", date: "2026-07-31", rating: 5, body: "良い" };
  assert.notEqual(reviewHash(base), reviewHash({ ...base, body: "とても良い" }));
});
