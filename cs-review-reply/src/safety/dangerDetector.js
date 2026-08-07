// ★★ 安全の中核（2-2 / 2-3）★★
// 「社員の確認が必要か（needsHuman）」を、AIの返事に頼らず“プログラム側で独立に”判定します。
// AIが「大丈夫」と言っても、ここが危険と判断したら危険側を採用します。
//
// 判定は2つの理由で立ちます：
//   (A) 星が ratingThreshold 以下（既定★3以下）
//   (B) 危険語を含む（ただし誤検知しないよう除外ルールを通したうえで）
//
// 変えたくなる値（語・除外語・しきい値）は config/danger-words.json 側にあります。

// 日本語の助詞っぽい文字（「けが」判定の補助に使用）
const PARTICLES = new Set([
  "を", "が", "は", "も", "に", "で", "と", "の", "へ", "や", "か", "ね", "よ", "。", "、", "！", "!", "？", "?", " ", "\n",
]);

// 「けが」の直後にこれらが来たら『けがする/けがして/けがさせ』等の負傷とみなす。
// ★後ろが助詞でなくても、する動詞の活用は負傷として拾う（安全側：実害の見逃しを防ぐ）。
const KEGA_VERB_NEXT = new Set(["し", "す", "さ", "を", "人"]);

// 指定語が本文のどこに出現するかの位置リストを返す
function indicesOf(text, word) {
  const out = [];
  let i = text.indexOf(word);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(word, i + 1);
  }
  return out;
}

// 「壊れ/破損/故障」が“他社製品・過去の話・買い替え理由”かどうかを見て、除外すべきなら true。
// ★落とし穴2-3の実例：
//   「以前使っていたキャリーケースが壊れている」→ 他社/過去 → 除外
//   「遂に壊れたので購入」→ 買い替え理由 → 除外
function isDamageExcluded(text, idx, word, cfg) {
  // (1) 直前の文脈に「以前/前に/他社/…」があるか（同じ文の範囲＝直近30文字を見る）
  const before = text.slice(Math.max(0, idx - 30), idx);
  for (const ctx of cfg.pastContext) {
    if (before.includes(ctx)) return true;
  }
  // (2) 「壊れたので購入」「買い替え」の形か（語の直後〜少し先を見る）
  const after = text.slice(idx, idx + word.length + 12);
  for (const rep of cfg.replacementContext) {
    if (after.includes(rep)) return true;
  }
  // 念のため、文全体に「買い替え」系があり、かつ否定的な訴え語（返品/返金/不良）が無い場合も
  // 買い替え文脈とみなす、まではやらない（過剰除外を避ける）。ここは after 近接のみに留めます。
  return false;
}

// 「けが/怪我」の誤検知除外。
// ★落とし穴2-3：「軽いだけが取り柄」の“だけが”に反応してしまった実例。
//   ルール：直前が「だ」「わ」なら除外（〜だけが／〜わけが）。
//           さらに、injury として数えるのは「後ろが助詞」のときだけにする。
function isKegaInjury(text, idx, word, cfg) {
  const prev = text[idx - 1];
  if (prev && cfg.kegaPrecedingExclude.includes(prev)) return false; // 〜だけが/〜わけが → 除外
  const next = text[idx + word.length];
  // 後ろが助詞・文末・する動詞の活用なら「けが（負傷）」として扱う。
  if (next === undefined || PARTICLES.has(next) || KEGA_VERB_NEXT.has(next)) return true;
  // それ以外（別語の一部の可能性）は誤検知を避けて“injuryではない”に倒す。
  return false;
}

// review = { rating(number|null), body(string) }
// dw     = danger-words.json の中身（config/danger-words.json）
// 返り値：{ needsHuman, reasons:[string], hitWords:[string] }
export function detectDanger(review, dw) {
  const text = String(review.body || "");
  const reasons = [];
  const hitWords = [];

  // (A) 星による判定（AIに関係なく、ここで独立に決める）
  const rating = typeof review.rating === "number" ? review.rating : null;
  if (rating !== null && rating <= dw.ratingThreshold) {
    reasons.push(`★${rating}（${dw.ratingThreshold}以下）のため確認が必要`);
  }

  // (B) 危険語による判定（除外ルールを通す）
  const damageSet = new Set(dw.damageWords);
  for (const word of dw.words) {
    const positions = indicesOf(text, word);
    if (positions.length === 0) continue;

    let counted = false;
    for (const idx of positions) {
      // 「けが」「怪我」は専用ルール
      if (word === "けが") {
        if (!isKegaInjury(text, idx, word, dw)) continue;
      }
      // 「壊れ/破損/故障」は過去/他社/買い替えを除外
      if (damageSet.has(word)) {
        if (isDamageExcluded(text, idx, word, dw)) continue;
      }
      counted = true;
      break; // その語は1回でも有効ヒットがあれば十分
    }

    if (counted) {
      hitWords.push(word);
    }
  }

  if (hitWords.length > 0) {
    reasons.push(`注意が必要な語を含む：${hitWords.join("・")}`);
  }

  return {
    needsHuman: reasons.length > 0,
    reasons,
    hitWords,
  };
}
