import { createHash } from "node:crypto";

// ★落とし穴2-5：送信済み記録は「元に戻せないハッシュ」で持ちます。
//   レビューの id（種別＋商品＋投稿者＋日付＋本文の組み合わせ）から
//   一方向ハッシュを作り、本文や投稿者名そのものは保存しません。
//   同じレビューを二度処理しないための「指紋」だけを残すイメージです。
export function reviewHash(review) {
  const material = [
    review.kind, // shop / item
    review.itemId || "",
    review.author || "",
    review.date || "",
    review.rating || "",
    review.body || "",
  ].join("");
  return createHash("sha256").update(material, "utf8").digest("hex");
}
