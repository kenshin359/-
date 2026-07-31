// レビューを3つの流れに振り分けます。
//   1) CS（返信下書き）      … すべてのレビューが対象
//   2) 中国（制作）チーム報告 … クレーム・低評価（＝商品改善のヒント）
//   3) SNSチーム共有         … 好評・SNS企画に使えそうなレビュー
//
// ★安全の考え方：中国チーム報告に「入れる/入れない」はコード側の条件を主にします
//   （AIの気分で漏れないように）。SNSは“出しても害が少ない”ので、まず安全条件で足切りし、
//   そのうえで AI の sns_worthy を参考にします。

const SNS_MIN_LEN = 40; // AIが無いときのフォールバック：この長さ以上の★5を候補にする

// 引数：
//   review = { rating, body }
//   ai     = generateReply の結果
//   danger = detectDanger の結果（needsHuman 等）
// 返り値：{ toChina(bool), toSns(bool) }
export function classify({ review, ai, danger }) {
  const rating = typeof review.rating === "number" ? review.rating : null;

  // ── 中国（制作）チーム：クレーム・低評価 ──────────────
  // 条件（どれかに当てはまれば報告）：
  //   ・★3以下
  //   ・危険語ヒット（不良・破損・故障 等）
  //   ・AIが「商品への不満」と判断し、かつ否定的
  const toChina =
    (rating !== null && rating <= 3) ||
    (danger.hitWords && danger.hitWords.length > 0) ||
    (ai.is_product_complaint && ai.sentiment === "negative");

  // ── SNSチーム：好評・SNS企画向き ──────────────────────
  // まず安全条件で足切り（低評価・要確認は除外）、そのうえで“使えそう”を拾う。
  const positiveEnough = rating === null ? false : rating >= 4;
  const safe = !danger.needsHuman && !toChina;

  let snsUsable;
  if (ai._offline) {
    // AIが無いときのフォールバック：★5かつある程度の長さ
    snsUsable = rating === 5 && String(review.body || "").length >= SNS_MIN_LEN;
  } else {
    snsUsable = !!ai.sns_worthy;
  }

  const toSns = positiveEnough && safe && snsUsable;

  return { toChina, toSns };
}
