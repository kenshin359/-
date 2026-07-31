// 楽天レビューページのHTMLから、1件ずつのレビューを取り出します。
//
// ★注意：楽天のHTML構造は予告なく変わります。ここは“壊れやすい層”なので、
//   複数の手がかりで拾えるようにし、拾えなかったら静かに0件ではなく
//   「拾えなかった」と分かるようにしています（呼び出し側でログ）。
//   安全判定・文面組み立て・分類・整形は、この層と切り離してテスト可能にしています。
//
// ★落とし穴5-3：商品レビューは本文の前に“商品名や販促文”がくっついて取れる。
//   「同じ文が3回以上出たら定型文」方式は失敗（販促文がレビューごとに違うため）。
//   → <title>の商品名の単語を4つ以上含む長い行を落とす方式で対処。
//     末尾の感想（「…出張 最高の質感！」→「最高の質感！」）は残す。

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s) {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).trim();
}

// 日付を YYYY-MM-DD に正規化（拾えなければ ""）
function normalizeDate(raw) {
  if (!raw) return "";
  let m = raw.match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return "";
}

// 星（1〜5）を色々な手がかりから拾う
function extractRating(block) {
  // alt="5" / aria-label="5" / "評価: 5" / "★5" など
  let m =
    block.match(/(?:alt|aria-label)\s*=\s*["']?\s*([1-5])(?:\.0)?\s*(?:点|つ星|star)?["']?/i) ||
    block.match(/評価[^0-9]{0,4}([1-5])/) ||
    block.match(/★\s*([1-5])/) ||
    block.match(/"rating"\s*:\s*"?([1-5])/i);
  return m ? parseInt(m[1], 10) : null;
}

// 商品名の単語集合（2文字以上）を作る（5-3の行除去に使用）
function titleWordSet(productTitle) {
  if (!productTitle) return new Set();
  const words = productTitle
    .split(/[\s　,、。・/｜|【】\[\]()（）!！?？+＋]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  return new Set(words);
}

// ★5-3：商品名の単語を4つ以上含む長い行は「商品名＋販促文」とみなして落とす。
//   ただし短い行（末尾の感想など）は残す。
function stripProductNameLines(body, titleWords) {
  if (titleWords.size === 0) return body;
  const lines = body.split("\n");
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let hit = 0;
    for (const w of titleWords) {
      if (t.includes(w)) hit++;
    }
    // 単語4つ以上を含み、かつ“長い行”なら販促/商品名の混入とみなして除去
    const looksLikeHeader = hit >= 4 && t.length >= 15;
    if (looksLikeHeader) continue;
    kept.push(t);
  }
  const result = kept.join("\n").trim();
  // 全部落ちてしまったら元に戻す（拾いすぎ防止）
  return result.length > 0 ? result : body.trim();
}

// レビューの塊を、ページから“ざっくり”切り出す。
// 楽天のレビュー1件は、星・日付・本文が近接して並ぶ。ここでは
// 「日付らしき文字列」を区切りの目印にして前後をまとめる素朴な方式にする。
function splitIntoBlocks(html) {
  // スクリプト/スタイルを除去してノイズを減らす
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  // レビュー本体が入りがちなコンテナ（class名に review を含む）を優先的に集める
  const blocks = [];
  const re = /<(?:div|li|article)[^>]*class=["'][^"']*review[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1] && m[1].length > 30) blocks.push(m[1]);
  }
  return blocks;
}

// HTML → レビュー配列
//   kind: "shop" | "item"
//   productTitle: item のとき商品名（5-3の除去に使用）
export function parseReviews(html, { kind, productTitle = "" } = {}) {
  const titleWords = kind === "item" ? titleWordSet(productTitle) : new Set();
  const blocks = splitIntoBlocks(html);
  const reviews = [];

  for (const block of blocks) {
    const rating = extractRating(block);
    // 日付らしき文字列
    const dateRaw =
      (block.match(/\d{4}[年/\-.]\d{1,2}[月/\-.]\d{1,2}日?/) || [])[0] || "";
    const date = normalizeDate(dateRaw);

    let body = stripTags(block);
    // 星や日付の数値ノイズが本文頭に残ることがあるので、日付文字列は本文から除く
    if (dateRaw) body = body.split(dateRaw).join(" ").trim();

    // 商品レビューは商品名/販促文の混入を除去
    if (kind === "item") body = stripProductNameLines(body, titleWords);

    // 本文が短すぎる/星が無いものはレビューではないとみなす
    if (!body || body.length < 4) continue;

    reviews.push({
      kind,
      rating: rating,
      date,
      author: extractAuthor(block),
      body,
    });
  }
  return reviews;
}

// 投稿者名（"○○さん" 等）。取れなければ空。
function extractAuthor(block) {
  const m =
    block.match(/([^\s<>　]{1,20})\s*さん/) ||
    block.match(/購入者[:：]?\s*([^\s<>　]{1,20})/);
  return m ? m[1].trim() : "";
}
