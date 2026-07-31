// CSアルバイトさん向けの Chatwork 文面（4.）。
//   ・先頭に作業手順、そのあと1件ずつ
//   ・商品ごとにまとめて並べる（同じ楽天ページで続けて作業できるように）
//   ・🟢 そのまま貼れる / 🔴 社員の確認が必要（理由必須）
// ★装飾（[info]等）は使わない：貼り付け時に記号が入るのを避けるため（5-4）。

// entries: [{ kind, productName, rating, date, author, body, reply, needsHuman, reasons }]
export function formatCs(entries, dateLabel) {
  const total = entries.length;
  const green = entries.filter((e) => !e.needsHuman).length;
  const red = total - green;

  // 内訳（商品ごとの件数）
  const byProduct = groupByProduct(entries);
  const breakdown = Object.entries(byProduct)
    .map(([name, list]) => `${name} ${list.length}件`)
    .join(" / ");

  const header =
`📝 楽天レビュー返信（${dateLabel}分・全${total}件）
内訳: ${breakdown || "なし"}
🟢 そのまま貼れる: ${green}件
🔴 社員の確認が必要: ${red}件
【作業手順】
1. RMS →「レビュー・注文サポート」→「レビューチェックツール」を開く
2. 下の順番どおりに、対象のレビューを探す
3. 🟢 は下書きをそのままコピーして貼り、投稿する
4. 🔴 は投稿せず、このグループで社員に声をかける
5. 投稿できたら、このメッセージに 👍 を付ける
※ 迷ったら投稿しないでください。あとで直すより聞くほうが早いです。`;

  const blocks = [];
  let n = 0;
  // 商品ごとにまとめて並べる
  for (const [productName, list] of Object.entries(byProduct)) {
    for (const e of list) {
      n++;
      blocks.push(formatOne(e, n, total, productName));
    }
  }

  return [header, ...blocks].join("\n\n━━━━━━━━━━━━━━━━━━\n");
}

function groupByProduct(entries) {
  const map = {};
  for (const e of entries) {
    const key = e.productName || (e.kind === "shop" ? "ショップレビュー" : "商品レビュー");
    (map[key] ||= []).push(e);
  }
  return map;
}

function formatOne(e, n, total, productName) {
  const kindLabel = e.kind === "shop" ? "【ショップレビュー】" : `【${productName}】`;
  const star = "★" + (e.rating ?? "?");
  const status = e.needsHuman
    ? "🔴 社員の確認が必要（投稿しないでください）"
    : "🟢 そのままコピーして貼ってください";

  let head =
`【${n}/${total}】 ${kindLabel}
${star}　${e.date || ""}　${e.author || "お客様"}さん
${status}`;

  // 🔴 のときは理由を必ず書く（4.）
  if (e.needsHuman && e.reasons && e.reasons.length) {
    head += `\n▼ 確認が必要な理由\n・${e.reasons.join("\n・")}`;
  }

  const review =
`▼ お客様のレビュー
${e.body || ""}`;

  // コピペ用の下書き（装飾なし・区切り線で囲む）
  const draft =
`▼ 返信の下書き（ここから ↓↓↓ ）
- - - - - - - - - -
${e.reply || ""}
- - - - - - - - - -
（ここまで ↑↑↑ をコピー）`;

  return [head, review, draft].join("\n\n");
}
