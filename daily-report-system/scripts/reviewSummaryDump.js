#!/usr/bin/env node
// ============================================================
//  レビュー集計のダンプ（経営ボード用・手動実行）
// ------------------------------------------------------------
//  楽天の公開レビュー（ショップ＋設定済み商品）を読み、
//  件数・平均★・★分布・直近30日・部位別の不満件数を集計してログに出す。
//  ★本文は出力しない（件数と平均だけ）。数字は 0-9 → A-J に置換。
//
//  実行: node scripts/reviewSummaryDump.js --pages=10
// ============================================================
import {
  fetchShopReviews,
  fetchItemReviews,
  itemsFromConfig,
} from '../lib/rakutenReviews.js';
import { extractInsights, prioritize } from '../lib/reviewInsights.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const enc = (s) => String(s).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);

function toISO(jp) {
  const [y, m, d] = String(jp).split('/').map(Number);
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function summarize(rows, todayISO) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  const recent = [];
  const since = new Date(new Date(`${todayISO}T00:00:00Z`).getTime() - 29 * 86400000);
  for (const r of rows) {
    const s = Number(r.star) || 0;
    if (s >= 1 && s <= 5) dist[s] += 1;
    sum += s;
    const iso = toISO(r.date);
    if (iso && new Date(`${iso}T00:00:00Z`) >= since) recent.push(r);
  }
  const avg = rows.length ? Number((sum / rows.length).toFixed(2)) : null;
  const rsum = recent.reduce((a, r) => a + (Number(r.star) || 0), 0);
  return {
    count: rows.length,
    avg,
    dist,
    last30: {
      count: recent.length,
      avg: recent.length ? Number((rsum / recent.length).toFixed(2)) : null,
      low: recent.filter((r) => Number(r.star) <= 3).length,
      noReply: recent.filter((r) => !r.shopReply).length,
    },
    oldest: rows.length ? rows.reduce((m, r) => (toISO(r.date) && toISO(r.date) < m ? toISO(r.date) : m), '9999-99-99') : null,
    newest: rows.length ? rows.reduce((m, r) => (toISO(r.date) && toISO(r.date) > m ? toISO(r.date) : m), '0000-00-00') : null,
  };
}

async function main() {
  const pages = Number(arg('pages', '10'));
  const todayISO = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const shop = await fetchShopReviews(pages);
  console.log(`ショップレビュー: ${shop.length}件`);

  const items = [];
  const all = [...shop];
  for (const it of itemsFromConfig()) {
    try {
      const rows = await fetchItemReviews(it.review_id, Math.min(pages, 4));
      items.push({ product: it.product || String(it.review_id), ...summarize(rows, todayISO) });
      all.push(...rows);
      console.log(`商品レビュー ${it.product || it.review_id}: ${rows.length}件`);
    } catch (e) {
      console.log(`商品レビュー ${it.product || it.review_id}: 取得失敗 (${e.message})`);
    }
  }

  const insights = extractInsights(all);
  const parts = prioritize(insights.parts, 5).slice(0, 10).map((p) => ({
    label: p.label,
    mentions: p.mentions,
    complaints: p.complaints,
    complaintRate: p.complaintRate,
    avgStar: p.avgStar ?? null,
  }));

  const out = {
    asOf: todayISO,
    shop: summarize(shop, todayISO),
    items,
    parts,
    reviewCount: insights.reviewCount,
    complaintSentences: insights.complaintSentences,
  };
  console.log('===REVIEW_SUMMARY_B===');
  console.log(enc(JSON.stringify(out)));
  console.log('===REVIEW_SUMMARY_E===');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
