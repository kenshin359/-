// 制作の中国チーム向け「クレーム・低評価」日次報告（日本語・シンプル）。
//   毎日まとめて1通。商品ごとに、何が問題か（改善のヒント）が分かる形にします。
// ★お客様情報の扱い：投稿者名は載せません（改善に不要。社内共有先が増えるため最小限に）。

// entries: [{ productName, rating, date, body, issueCategory, issueSummary }]
export function formatChina(entries, dateLabel) {
  if (entries.length === 0) return null;

  // 商品ごとにまとめる（同じ商品の不具合を並べて見られるように）
  const byProduct = {};
  for (const e of entries) {
    const key = e.productName || "（商品不明・ショップレビュー）";
    (byProduct[key] ||= []).push(e);
  }

  // カテゴリ別の件数サマリー（どの不具合が多いか一目で分かるように）
  const catCount = {};
  for (const e of entries) {
    const c = e.issueCategory && e.issueCategory !== "なし" ? e.issueCategory : "その他";
    catCount[c] = (catCount[c] || 0) + 1;
  }
  const catSummary = Object.entries(catCount)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} ${n}件`)
    .join(" / ");

  const header =
`⚠️ 楽天レビュー クレーム・低評価 日次報告（${dateLabel}）
件数: ${entries.length}件
内訳: ${catSummary}
※ 商品改善のご参考にお願いします。星3以下・不良/破損の指摘を集めています。`;

  const blocks = [];
  for (const [productName, list] of Object.entries(byProduct)) {
    const lines = [`■ ${productName}（${list.length}件）`];
    for (const e of list) {
      const cat = e.issueCategory && e.issueCategory !== "なし" ? `［${e.issueCategory}］` : "";
      const summary = e.issueSummary ? `\n  要点: ${e.issueSummary}` : "";
      lines.push(
`・★${e.rating ?? "?"}　${e.date || ""}　${cat}${summary}
  レビュー: ${e.body || ""}`
      );
    }
    blocks.push(lines.join("\n"));
  }

  return [header, ...blocks].join("\n\n──────────\n");
}
