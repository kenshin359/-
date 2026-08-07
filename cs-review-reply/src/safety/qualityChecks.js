// 出来上がった返信文の品質チェック（実運用で見つかった問題への安全ネット）。
// AIプロンプトを直しても“たまに”すり抜けるので、機械的にも点検し、
// 怪しいものは🔴（人の確認）へ回します。設定は config/quality-check.json。

// ── 問題1：コピペ時の 〝 〟 などの引用符を自動除去 ──────────────
// AI出力が時々、文全体を引用符で包むことがある。始まり/終わりの引用符だけ落とす。
// ※「」『』は日本語本文で正当に使われるので触らない（先頭/末尾が対の時のみ後段で処理）。
const EDGE_QUOTES = "〝〟〞“”„\"＂'‘’`";
export function stripWrappingQuotes(text) {
  if (!text) return text;
  let t = String(text).trim();
  // 先頭・末尾の引用符＋空白を繰り返し除去
  const open = new RegExp(`^[\\s${EDGE_QUOTES}]+`);
  const close = new RegExp(`[\\s${EDGE_QUOTES}]+$`);
  t = t.replace(open, "").replace(close, "");
  // 文全体が「…」または『…』で包まれている時だけ、その対を外す
  if ((t.startsWith("「") && t.endsWith("」")) || (t.startsWith("『") && t.endsWith("』"))) {
    // 中に同種の括弧が無い（＝全体を包んでいるだけ）場合のみ
    const inner = t.slice(1, -1);
    if (!/[「」『』]/.test(inner)) t = inner.trim();
  }
  return t;
}

// ── 問題3：商品ミスマッチ（例：ファンにヒノモトキャスター）──────────
// category が suitcase 以外（fan/beauty）なのに、スーツケース固有語が出たら疑い。
// category が unknown（ショップレビュー等）は判定しない（誤検知を避ける）。
export function checkProductMismatch(replyText, category, cfg) {
  if (category !== "fan" && category !== "beauty") return { ok: true, reasons: [] };
  const hit = (cfg.suitcaseTerms || []).filter((w) => replyText.includes(w));
  if (hit.length === 0) return { ok: true, reasons: [] };
  return {
    ok: false,
    reasons: [`商品ミスマッチの疑い：${category}の返信にスーツケース用語（${hit.join("・")}）が入っています`],
  };
}

// ── 問題4：不満・要望なのに“満足・お褒め”で返している ──────────────
// レビューに要望/不満のサインがあり、返信が満足系を含み、かつお詫び/改善が無い → 誤読の疑い。
//
// ★否定形の除外（実測の誤検知）：「気になりません」「不満はありません」等は“肯定”なので不満ではない。
//   マーカーの直後に否定語があれば、その出現はカウントしない。
const NEGATIONS = ["ません", "ない", "なく", "ず", "ありません", "ございません", "なかった", "いません", "ねぇ"];
function markerIsRealComplaint(text, marker) {
  let i = text.indexOf(marker);
  while (i !== -1) {
    const after = text.slice(i + marker.length, i + marker.length + 8);
    if (!NEGATIONS.some((n) => after.includes(n))) return true; // 否定が続かない＝本当の不満
    i = text.indexOf(marker, i + 1);
  }
  return false;
}
export function checkComplaintMishandled(reviewBody, replyText, cfg) {
  const hasComplaint = (cfg.complaintMarkers || []).some((w) => markerIsRealComplaint(reviewBody, w));
  if (!hasComplaint) return { ok: true, reasons: [] };
  const hasPraise = (cfg.praiseMarkers || []).some((w) => replyText.includes(w));
  const hasApology = (cfg.apologyMarkers || []).some((w) => replyText.includes(w));
  if (hasPraise && !hasApology) {
    return {
      ok: false,
      reasons: ["不満/要望の誤読の疑い：レビューに要望・不満がありますが、返信がお詫び/改善に触れず満足・お褒めで返しています"],
    };
  }
  return { ok: true, reasons: [] };
}

// ── 問題2：語尾・言い回しの重複 ──────────────────────────────
export function checkRepeatedPhrases(replyText, cfg) {
  const reasons = [];
  // ★特徴的な言い回し（安心いたしました 等）が2回以上 → 語尾重複（問題2）。
  //   「ありがとうございます」のような一般的なお礼は、挨拶＋感謝で自然に重なるため
  //   ここでは数えません（数えると大量に🔴になり『そのまま貼れる』価値が消えるため）。
  //   お礼の重複そのものは、AIプロンプト側で「③はお礼で締めない」よう指示して抑えています。
  for (const p of cfg.repeatPhrases || []) {
    const count = replyText.split(p).length - 1;
    if (count >= 2) reasons.push(`言い回しの重複：「${p}」が${count}回`);
  }
  return { ok: reasons.length === 0, reasons };
}

// まとめて実行して、needsHuman 用の理由配列を返す
export function runQualityChecks({ reviewBody, replyText, category }, cfg) {
  const reasons = [];
  for (const r of [
    checkProductMismatch(replyText, category, cfg),
    checkComplaintMishandled(reviewBody, replyText, cfg),
    checkRepeatedPhrases(replyText, cfg),
  ]) {
    if (!r.ok) reasons.push(...r.reasons);
  }
  return { ok: reasons.length === 0, reasons };
}
