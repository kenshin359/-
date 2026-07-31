// 返信の③④と、振り分け用のメタ情報を、AIに1回のリクエストで作らせます。
// ★重要（2-2）：ここで返る needs_human 等の「安全判定」は使いません。
//   安全判定はあくまで dangerDetector.js（プログラム側）が決めます。
//   AIには「文章づくり」と「参考情報（分類・SNS向きか）」だけを任せます。
//
// SDKは使わず fetch で直接叩く（依存を増やさない）。
// APIキーが無い／APP_ENV=test のときは、オフラインでも --dry-run できるよう
// 決め打ちの安全なひな形を返します（本番運用では必ずキーを設定してください）。

// 3-4：過去返信でよく使われている言い回し（文体を寄せるための手本）
const STYLE_EXAMPLES = [
  "〜についてのお褒めのお言葉ありがとうございます。",
  "そのようにおっしゃっていただけて、大変光栄です。",
  "ご不快な思いをさせてしまい大変申し訳ございません。",
  "今後の商品改善の参考にさせていただきます。",
  "検品体制の見直しに努めてまいります。",
];

function buildPrompt(review) {
  return `あなたは日本の通販会社CSチームの返信文作成担当です。楽天レビューへの返信の一部を作ります。

# 手本の言い回し（この文体・丁寧さに寄せる。AI独自の言葉遣いにしない）
${STYLE_EXAMPLES.map((s) => "- " + s).join("\n")}

# 書き方の決まり
- ③本文：レビューに書かれている“具体的な言葉”を拾う（例：「キャスターが静か」なら静音性に触れる）。何にでも当てはまる文にしない。用途（旅行・出張・プレゼント・買い替え）が書かれていたら触れる。2〜4文、150字以内、敬体、感嘆符を多用しない。
- ④謝罪・改善：不満・要望・納期の遅れ・使いにくさが書かれているときだけ書く。まず謝る。言い訳を先に書かない。「今後の商品改善の参考にさせていただきます」で締める。無いなら空文字。
- ★できない約束は絶対にしない：「送料無料」「弊社負担」「全額」「返金します」「新品と交換」「無償で交換」などは書かない。

# 出力（JSONのみ。前後に説明文を付けない）
{
  "body": "③本文",
  "needs_apology": true/false,
  "apology": "④謝罪文（不要なら空文字）",
  "sentiment": "positive|neutral|negative",
  "is_product_complaint": true/false,
  "issue_category": "品質|破損|初期不良|使いにくさ|サイズ|におい|配送|その他|なし",
  "issue_summary": "制作チーム向けに、何が問題かを一文で（日本語。複数商品の改善に使える具体性で。不満が無ければ空文字）",
  "sns_worthy": true/false,
  "sns_reason": "SNS企画に使えそうな理由を一言（使えなければ空文字）"
}

# 対象レビュー
星: ${review.rating ?? "不明"}
本文:
${review.body}`;
}

// オフライン時の安全なひな形（API未設定・test 用）。
// 個別化はできないが「当たり障りのない・約束をしない」文にとどめます。
function offlineFallback(review) {
  const rating = typeof review.rating === "number" ? review.rating : null;
  const negative = rating !== null && rating <= 3;
  return {
    body: negative
      ? "お寄せいただいた内容を、担当にて確認しております。お気づきの点を教えていただけたこと、重ねて御礼申し上げます。"
      : "お寄せいただいたお言葉を、開発・検品の担当一同、大変励みにしております。",
    needs_apology: negative,
    apology: negative
      ? "ご期待に沿えない点があり、大変申し訳ございません。今後の商品改善の参考にさせていただきます。"
      : "",
    sentiment: negative ? "negative" : "positive",
    is_product_complaint: negative,
    issue_category: "なし",
    issue_summary: "",
    sns_worthy: false,
    sns_reason: "",
    _offline: true,
  };
}

function extractJson(text) {
  // AIが前後に文字を付けた場合に備え、最初の { から最後の } までを取り出す
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1 || e < s) throw new Error("AI応答からJSONを取り出せませんでした");
  return JSON.parse(text.slice(s, e + 1));
}

// review = { rating, body, ... }
export async function generateReply(review, cfg) {
  // APIキーが無い、または test モードのときはオフラインひな形。
  // （test 中に外部へ送らない＝誤爆防止の一環。本番では production + キーで動きます）
  if (!cfg.anthropic.apiKey) {
    return offlineFallback(review);
  }

  const body = {
    model: cfg.anthropic.model,
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(review) }],
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
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Anthropic API エラー ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    const parsed = extractJson(text);
    // 型をそろえる（欠けていても落ちないように）
    return {
      body: parsed.body || "",
      needs_apology: !!parsed.needs_apology,
      apology: parsed.apology || "",
      sentiment: parsed.sentiment || "neutral",
      is_product_complaint: !!parsed.is_product_complaint,
      issue_category: parsed.issue_category || "なし",
      issue_summary: parsed.issue_summary || "",
      sns_worthy: !!parsed.sns_worthy,
      sns_reason: parsed.sns_reason || "",
    };
  } catch (err) {
    // ★安全側：AIが失敗しても止めない。ひな形に切り替え、必ず人の確認へ回します。
    //   （このレビューは needsHuman 側で拾われるので、当たり障りのない文で人に渡す）
    return { ...offlineFallback(review), _aiError: String(err.message || err) };
  }
}
