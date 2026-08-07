// 『合議レビュー』（2パス目）。
// 生成した下書き（③本文・④謝罪）を、優秀なCS3人＋管理職＋役員の5役で点検・添削します。
// ★ユーザー要望「優秀なCSサポート3人＋管理職＋役員を混ぜてClaudeに指示を飛ばす」を、
//   実運用の“毎回の返信”に組み込んだものです。精度（誤読・商品ミスマッチ・重複・約束）を上げます。
//
// AIキーが無い／council.enabled=false のときは何もせず下書きをそのまま返します。
// 途中で失敗しても、元の下書きを壊さない（安全側）。

import { stripWrappingQuotes } from "../safety/qualityChecks.js";

const CATEGORY_LABEL = {
  suitcase: "スーツケース／キャリーケース",
  fan: "ハンディファン／扇風機（クリップ・卓上・首振り等）",
  beauty: "美容家電（ドライヤー・洗顔ブラシ等）",
  unknown: "（商品は特定できません：ショップ全体または不明）",
};

function extractJson(text) {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1 || e < s) throw new Error("合議レビューの応答からJSONを取り出せませんでした");
  return JSON.parse(text.slice(s, e + 1));
}

export function buildCouncilPrompt(review, draft, cfg) {
  const cat = review.category || "unknown";
  const catLabel = CATEGORY_LABEL[cat] || CATEGORY_LABEL.unknown;
  const productName = review.productName && review.productName !== "ショップレビュー" ? review.productName : "不明";
  const blocks = cfg.replyBlocks;
  const roles = (cfg.council.roles || []).map((r, i) => `${i + 1}. ${r.name}：${r.focus}`).join("\n");

  return `あなたは日本の通販会社（スーツケース・ハンディファン・美容家電）のCS品質会議です。
以下の「返信の下書き（③本文・④謝罪）」を、次の5役になりきって多角的に点検し、全員が合意できる最終版に添削してください。

# 5役（それぞれの視点で必ず点検する）
${roles}

# 対象商品
- 種別：${catLabel}
- 商品名：${productName}
★この商品に無い機能を、レビューに書かれていない限り書かないこと。種別がスーツケース以外なら「キャスター」「ヒノモトキャスター」「TSAロック」等のスーツケース語を使わないこと。

# お客様のレビュー
星：${review.rating ?? "不明"}
本文：
${review.body}

# 現在の下書き（この③④を添削対象とする。①②⑤⑥は下の固定文で前後に付くので、それらと重複させない）
- ①挨拶(固定)：${blocks.greeting}
- ②感謝(固定・状況で自動選択)：${blocks.thanks.default} / ${blocks.thanks.apology}
- ③本文(添削対象)：${draft.body || "(空)"}
- ④謝罪(添削対象・不要なら空)：${draft.apology || "(空)"}
- ⑤お問い合わせ(固定)：${blocks.contact}
- ⑥結び(固定)：${blocks.closing.default} / ${blocks.closing.suitcase}

# 添削の必須チェック（5役の総意で必ず直す）
- 誤読していないか：要望・不満（『〜たら良かった』等）を満足・お褒めと取り違えていないか。不満点にお礼を言っていないか。
- 商品ミスマッチが無いか：その商品に無い機能を書いていないか。
- 重複が無いか：③はお礼（ありがとうございます等）で締めない。①②と同じお礼を繰り返さない。同じ語尾を2回使わない。
- できない約束が無いか：送料無料・弊社負担・全額・返金します・新品交換・無償交換 は書かない。
- 文体：90〜130字目安、敬体、感嘆符を多用しない、囲み引用符（〝〟“”「」）で全体を囲まない。過去返信に沿った自然な日本語。

# 出力（JSONのみ。前後に説明文を付けない）
{
  "body": "添削後の③本文",
  "needs_apology": true/false,
  "apology": "添削後の④謝罪（不要なら空文字）",
  "changed": true/false,
  "council_notes": "5役の指摘の要約を一文で（社内向け・任意）"
}`;
}

// draft = { body, needs_apology, apology }（generateReply の1パス目の結果）
// 返り値：添削後の { body, needs_apology, apology, council_notes } または元のdraft
export async function councilReview(review, draft, cfg) {
  if (!cfg.anthropic.apiKey) return draft; // キーが無ければスキップ
  if (!cfg.council || cfg.council.enabled === false) return draft;

  const body = {
    model: cfg.anthropic.model,
    max_tokens: 1024,
    messages: [{ role: "user", content: buildCouncilPrompt(review, draft, cfg) }],
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.anthropic.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic API エラー ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    const parsed = extractJson(text);
    return {
      body: stripWrappingQuotes(parsed.body || draft.body || ""),
      needs_apology: typeof parsed.needs_apology === "boolean" ? parsed.needs_apology : draft.needs_apology,
      apology: stripWrappingQuotes(parsed.apology || ""),
      council_notes: parsed.council_notes || "",
    };
  } catch {
    // ★失敗しても元の下書きを壊さない（安全側）
    return draft;
  }
}
