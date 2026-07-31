// ★落とし穴2-4：出来上がった“返信文そのもの”を機械的に点検します。
//   プロンプトで禁止するだけでは足りない（AIがうっかり書くことがある）ため、
//   最終文面を正規表現でチェックし、できない約束をしていたら送らず人に回します。
//
// 変えたくなる値は config/promise-check.json 側にあります。

// replyText = 組み立て後の最終返信文
// 返り値：{ ok, violations:[string] }（ok=false なら警告付きで人に回す）
export function checkPromises(replyText, cfg) {
  const text = String(replyText || "");
  const violations = [];

  // 先に「正しい説明（allowed）」の位置を集めておく。
  // 例）「送料のみお客様のご負担をお願いしております」は通す（7.）。
  const allowedRanges = [];
  for (const phrase of cfg.allowed || []) {
    let i = text.indexOf(phrase);
    while (i !== -1) {
      allowedRanges.push([i, i + phrase.length]);
      i = text.indexOf(phrase, i + 1);
    }
  }
  const inAllowed = (pos) =>
    allowedRanges.some(([s, e]) => pos >= s && pos < e);

  for (const rule of cfg.forbidden) {
    const re = new RegExp(rule.pattern, "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      // その一致が「正しい説明」の範囲内なら誤検知なので飛ばす
      if (inAllowed(m.index)) continue;
      violations.push(rule.reason);
      break; // 同じ理由は1回でよい
    }
  }

  return { ok: violations.length === 0, violations };
}
