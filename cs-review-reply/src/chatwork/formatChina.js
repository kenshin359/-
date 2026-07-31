// 制作の中国チーム向け「不具合 日次報告」（日本語・シンプル）。1通にまとめて送ります。
//   セクションA：スプシ（CS問い合わせ管理表）から抜いた不具合リスト（主）
//   セクションB：楽天レビューの低評価から拾ったお客様の声（補足）
// ★個人情報は載せません（顧客名・注文番号・投稿者名は含めない）。

// group: { sheetDefects:[{date,product,color,category,detail,status}],
//          reviewComplaints:[{productName,rating,date,body,issueCategory,issueSummary}] }
// meta:  { skippedNoDate }（任意・スプシで日付が無く除外した件数の注記）
export function formatChina(group, dateLabel, meta = {}) {
  const sheetDefects = group.sheetDefects || [];
  const reviewComplaints = group.reviewComplaints || [];
  if (sheetDefects.length === 0 && reviewComplaints.length === 0) return null;

  const header =
`⚠️ 不具合 日次報告（${dateLabel}）
・CS問い合わせ管理表(スプシ): ${sheetDefects.length}件
・楽天レビューの低評価: ${reviewComplaints.length}件
※ 商品改良のご参考にお願いします。個人情報（顧客名・注文番号）は除いています。`;

  const sections = [header];

  // ── セクションA：スプシの不具合リスト ──────────────
  if (sheetDefects.length > 0) {
    sections.push(formatSheetSection(sheetDefects, meta));
  }

  // ── セクションB：楽天レビュー由来 ─────────────────
  if (reviewComplaints.length > 0) {
    sections.push(formatReviewSection(reviewComplaints));
  }

  return sections.join("\n\n════════════════\n");
}

function formatSheetSection(defects, meta) {
  // 商品ごとにまとめる
  const byProduct = {};
  for (const d of defects) {
    (byProduct[d.product] ||= []).push(d);
  }
  // カテゴリ別件数
  const catCount = {};
  for (const d of defects) catCount[d.category] = (catCount[d.category] || 0) + 1;
  const catSummary = Object.entries(catCount)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} ${n}件`)
    .join(" / ");

  const lines = [`■ CS問い合わせ管理表より（${defects.length}件）`, `内訳: ${catSummary}`];
  if (meta && meta.skippedNoDate) {
    lines.push(`（※日付なしで対象外にした不具合が ${meta.skippedNoDate}件あります）`);
  }

  const blocks = [];
  for (const [product, list] of Object.entries(byProduct)) {
    const b = [`【${product}】（${list.length}件）`];
    for (const d of list) {
      const color = d.color ? `・${d.color}` : "";
      const status = d.status ? `［${d.status}］` : "";
      b.push(`・${d.date || "日付なし"}${color}　${d.category}${status}\n  ${d.detail || "(詳細なし)"}`);
    }
    blocks.push(b.join("\n"));
  }

  return [lines.join("\n"), ...blocks].join("\n\n");
}

function formatReviewSection(reviews) {
  const byProduct = {};
  for (const r of reviews) {
    (byProduct[r.productName || "（商品不明）"] ||= []).push(r);
  }
  const lines = [`■ 楽天レビューの低評価より（${reviews.length}件）`];
  const blocks = [];
  for (const [product, list] of Object.entries(byProduct)) {
    const b = [`【${product}】（${list.length}件）`];
    for (const r of list) {
      const cat = r.issueCategory && r.issueCategory !== "なし" ? `［${r.issueCategory}］` : "";
      const summary = r.issueSummary ? `\n  要点: ${r.issueSummary}` : "";
      b.push(`・★${r.rating ?? "?"}　${r.date || ""}　${cat}${summary}\n  レビュー: ${r.body || ""}`);
    }
    blocks.push(b.join("\n"));
  }
  return [lines.join("\n"), ...blocks].join("\n\n");
}
