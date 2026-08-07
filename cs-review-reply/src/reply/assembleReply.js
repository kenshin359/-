// 返信文の組み立て（3-1 の6ブロック）。
//   ①挨拶       固定
//   ②感謝       固定3種から“状況で”選ぶ（★3-2の失敗対策）
//   ③本文       AIが書く
//   ④謝罪・改善  AIが書く（必要なときだけ）
//   ⑤お問い合わせ 固定
//   ⑥結び       商品で出し分け（★3-3の失敗対策）
//
// AIの出力（③④）と、コード側で決める②⑥を、ここで安全に合成します。

const LONG_REVIEW_CHARS = 120; // 3-2：120字以上は「丁寧で詳細な」感謝文

// 引数：
//   review  = { rating, body, category }  category は商品分類（suitcase等）
//   ai      = { body(③), needsApology, apology(④) }
//   danger  = detectDanger の結果（needsHuman 等）
//   blocks  = reply-blocks.json
export function assembleReply({ review, ai, danger, blocks }) {
  const rating = typeof review.rating === "number" ? review.rating : null;

  // ── ②感謝の出し分け ──────────────────────────────
  // ★3-2：謝罪が入るのに「嬉しく思います」は失礼。
  //   謝罪が入るか＝AIが謝罪ありと判断 or 星が低い（＝どのみち不満寄り）。
  //   低評価レビューに「嬉しく思います」を絶対に付けないための二重の歯止め。
  const hasApology =
    !!ai.needsApology || (rating !== null && rating <= 3);

  const bodyLen = String(review.body || "").length;

  let thanks;
  if (hasApology) {
    thanks = blocks.thanks.apology;
  } else if (bodyLen >= LONG_REVIEW_CHARS) {
    thanks = blocks.thanks.long;
  } else {
    thanks = blocks.thanks.default;
  }

  // ── ⑥結びの出し分け ──────────────────────────────
  // ★3-3：スーツケース類と“判断できるとき”だけ suitcase。不明なら default。
  const closing =
    review.category === "suitcase"
      ? blocks.closing.suitcase
      : blocks.closing.default;

  // ── ④謝罪・改善（あるときだけ）────────────────────
  const apology = hasApology && ai.apology ? String(ai.apology).trim() : "";

  const parts = [
    blocks.greeting, // ①
    thanks, // ②
    String(ai.body || "").trim(), // ③
    apology, // ④（無ければ空 → 落とされる）
    blocks.contact, // ⑤
    closing, // ⑥
  ].filter((p) => p && p.length > 0);

  return parts.join("\n");
}
