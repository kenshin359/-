// 楽天レビューページのHTMLから、1件ずつのレビューを取り出します。
//
// ★実測（本番HTMLで確認済み）：レビューページは React 製で、
//   ページ内の `window.__INITIAL_STATE__ = {...}` に全レビューが構造化JSONで入っています。
//   これを読むのが最も確実です（星は数値、日付・本文・投稿者もそのまま取れる）。
//   → HTMLのclass名（例 review-body--LpVR4）はビルドごとに変わるので当てにしない。
//
//   JSONの形（実測）：
//     state.reviews.data[uuid] = { rating, body, nickname, postDate, orderDate,
//                                  shopReply?, key, ... }
//     state.reviews.shopReviews.keys = [uuid...]（ショップレビューの並び）
//     state.reviews.itemReviews.keys = [uuid...]（商品レビューの並び）
//     state.itemInfo.name            = 商品名（商品レビューページのとき）
//
// ★shopReply があるレビューは「すでに返信済み」。下書きを作る必要がないので除外できます。
//
// もし将来 __INITIAL_STATE__ が取れなくなった場合に備え、末尾に簡易HTMLパーサの
// フォールバックも残しています（本番では通常JSON経路が使われます）。

// window.__INITIAL_STATE__ = {...}; の {...} をバランスを見て取り出す
export function extractInitialState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*/);
  if (!m) return null;
  let i = html.indexOf("{", m.index);
  if (i === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(i, j + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

// "2026/07/31" → "2026-07-31"（取れなければ ""）
function normalizeDate(raw) {
  const m = String(raw || "").match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

// state から1件のレビューオブジェクトを、この仕組みで扱う形に正規化する
function normalizeReview(rev, kind) {
  const shopReply = (rev.shopReply || "").trim();
  return {
    kind, // "shop" | "item"
    rating: typeof rev.rating === "number" ? rev.rating : null,
    date: normalizeDate(rev.postDate || rev.orderDate),
    author: (rev.nickname || "").replace(/さん$/, "").trim(),
    body: (rev.body || "").trim(),
    shopReply, // 既存の返信（過去返信・文体の手本にもなる）
    replied: shopReply.length > 0, // ★返信済みかどうか
  };
}

// HTML → レビュー配列
//   kind: "shop" | "item"
// 返り値：{ reviews:[...], productName, total, source }
export function parseReviews(html, { kind } = {}) {
  const state = extractInitialState(html);

  // ── 本命：__INITIAL_STATE__ から取る ──────────────
  if (state && state.reviews && state.reviews.data) {
    const store = state.reviews.data;
    const group = kind === "item" ? state.reviews.itemReviews : state.reviews.shopReviews;
    let keys = (group && group.keys) || [];
    // keys が空なら data 全部を使う（保険）
    if (keys.length === 0) keys = Object.keys(store);

    const reviews = keys
      .map((k) => store[k])
      .filter(Boolean)
      .map((rev) => normalizeReview(rev, kind));

    const productName =
      kind === "item" && state.itemInfo && state.itemInfo.name ? state.itemInfo.name : "";
    const total = (group && group.count) || reviews.length;

    return { reviews, productName, total, source: "state" };
  }

  // ── フォールバック：簡易HTMLパーサ（JSONが取れないとき）──────
  return { reviews: parseReviewsFromHtmlFallback(html, kind), productName: "", total: 0, source: "html" };
}

// ───────────────────────────────────────────────
// 以降はフォールバック（通常は使われません）。
// __INITIAL_STATE__ が将来取れなくなったときの保険として、最低限の抽出を残します。
function stripTags(s) {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseReviewsFromHtmlFallback(html, kind) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out = [];
  // class名の“接頭辞”で本文を拾う（ハッシュ部分は無視）
  const re = /class="review-body--[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const body = stripTags(m[1]);
    if (body && body.length >= 4) {
      out.push({ kind, rating: null, date: "", author: "", body, shopReply: "", replied: false });
    }
  }
  return out;
}
