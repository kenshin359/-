// ============================================================
//  商品改良のためのレビュー分析
// ------------------------------------------------------------
//  「星がいくつか」ではなく、**どの部位が、どう不満なのか**を出します。
//
//  実行:
//    npm run product:analyze
//    npm run product:analyze -- --pages=30   … 読む件数を増やす
//
//  ★AIは使いません。辞書と規則による集計です（費用ゼロ・毎回同じ結果）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchItemReviews, fetchShopReviews, configuredItemIds } from '../lib/rakutenReviews.js';
import { extractInsights, prioritize, countIssues } from '../lib/reviewInsights.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const pages = Number(arg('pages', '25'));
  const ids = configuredItemIds();
  if (!ids.length) {
    console.error('RAKUTEN_ITEM_IDS が未設定です（商品レビューのIDをカンマ区切りで）');
    process.exit(1);
  }

  console.log(`商品レビューを取得します（${pages}ページ＝最大${pages * 30}件）…`);
  let item = [];
  for (const id of ids) {
    const rows = await fetchItemReviews(id, pages);
    console.log(`  商品(${id}): ${rows.length}件`);
    item = item.concat(rows);
  }
  const shop = await fetchShopReviews(10);
  console.log(`  ショップ: ${shop.length}件`);

  const insights = extractInsights(item);
  const priority = prioritize(insights.parts);
  const issues = countIssues(item);

  // 星ごとの母数（指摘の重みを判断するため）
  const dist = {};
  item.forEach((r) => (dist[r.star] = (dist[r.star] ?? 0) + 1));

  const out = {
    generatedAt: new Date().toISOString(),
    itemReviews: item.length,
    shopReviews: shop.length,
    starDistribution: dist,
    averageStar: Number((item.reduce((s, r) => s + r.star, 0) / (item.length || 1)).toFixed(3)),
    sentences: insights.sentenceCount,
    complaintSentences: insights.complaintSentences,
    parts: insights.parts,
    priority,
    issues,
  };

  const p = path.join(ROOT, 'out', 'product-issues.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 1), 'utf8');

  console.log(`\n✅ 書き出しました: ${p}`);
  console.log(`  読んだ文: ${out.sentences}（うち不満・要望を含む文 ${out.complaintSentences}）`);
  console.log('\n── 改良の優先度（言及の多さ × 不満率）──');
  for (const p2 of priority.slice(0, 8)) {
    console.log(`  ${String(p2.impact).padStart(6)}  ${p2.label}（${p2.mentions}件中${p2.complaints}件が不満）`);
  }
  console.log('\n── 1件あたりの打撃が大きい指摘（平均★が低い順）──');
  for (const i of issues.slice(0, 6)) {
    console.log(`  ★${i.avgStar}  ${i.label}（${i.count}件）`);
  }
}

main().catch((e) => {
  console.error('分析エラー:', e.message);
  process.exit(1);
});
