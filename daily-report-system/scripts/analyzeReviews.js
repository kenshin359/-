// ============================================================
//  楽天レビューの分析（商品レビュー / ショップレビュー）
// ------------------------------------------------------------
//  レビュー本文を読み、何が評価されているかを数値にします。
//  結果は out/review-analysis.json に出ます。
//
//  実行:
//    npm run reviews:analyze
//    npm run reviews:analyze -- --pages=10   … 読む件数を増やす（1ページ30件）
//
//  ★集計はすべてJS側で行い、AIは使いません（費用ゼロ）。
//  ★お客様の本文は out/ に留め、リポジトリには含めません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchShopReviews,
  fetchItemReviews,
  configuredItemIds,
  shopReviewUrl,
  itemReviewUrl,
} from '../lib/rakutenReviews.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** レビューで語られている話題の辞書 */
const THEMES = {
  '丁寧・迅速': /丁寧|親切|誠実|迅速|早い|速い|すぐに|即日/,
  配送: /配送|発送|到着|届いた|翌日|配達/,
  '対応・接客': /対応|接客|問い合わせ|問合せ|連絡|サポート|窓口|相談/,
  梱包: /梱包|包装|箱|外箱|ダンボール|段ボール/,
  'デザイン・質感': /デザイン|質感|高級感|見た目|色|カラー|おしゃれ|オシャレ/,
  キャスター: /キャスター|タイヤ|車輪|静音|静か/,
  '手紙・同梱物': /手紙|メッセージ|カード|ネームタグ|カバー|特典|おまけ/,
  永久保証: /保証|アフター/,
  フロントオープン: /フロントオープン|前開き|前面/,
  重量: /重い|重さ|軽い|軽量/,
  容量: /容量|入らない|入る|収納/,
  価格: /値段|価格|安い|コスパ|お得|高い|コストパフォーマンス/,
  '交換・不良': /交換|修理|不良|初期不良|壊れ|破損|故障|返品|返金/,
  リピート: /リピート|再購入|2回目|二回目|また購入|前回も|いつも/,
  ギフト: /プレゼント|贈り物|誕生日|入学|進学|お祝い|息子|娘|母に|父に/,
  '納期の不満': /届かな|遅れ|遅い|待ちました|指定日|入荷待ち|欠品/,
};

/** ページに書かれている公式の集計値（平均・件数・星の分布）を読む */
async function fetchOfficialStats(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  if (!res.ok) return null;
  const lines = (await res.text())
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // 「4.54」「(4,020件)」が並び、そのあとに 5→件数, 4→件数 … が続く
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d\.\d\d$/.test(lines[i])) continue;
    const m = (lines[i + 1] ?? '').match(/^\((\d[\d,]*)件\)$/);
    if (!m) continue;

    const dist = {};
    for (let s = 5; s >= 1; s--) {
      const idx = lines.indexOf(String(s), i + 2);
      const cnt = (lines[idx + 1] ?? '').match(/^(\d[\d,]*)件$/);
      if (cnt) dist[s] = Number(cnt[1].replace(/,/g, ''));
    }
    return {
      average: Number(lines[i]),
      total: Number(m[1].replace(/,/g, '')),
      distribution: Object.keys(dist).length ? dist : null,
    };
  }
  return null;
}

function analyzeSet(rows, label) {
  const n = rows.length || 1;
  const avg = (a) => (a.length ? a.reduce((s, r) => s + r.star, 0) / a.length : null);

  const themes = Object.entries(THEMES)
    .map(([name, re]) => {
      const hit = rows.filter((r) => re.test(r.body));
      return {
        name,
        count: hit.length,
        share: Number(((hit.length / n) * 100).toFixed(1)),
        avgStar: hit.length ? Number(avg(hit).toFixed(2)) : null,
      };
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  const dist = {};
  rows.forEach((r) => (dist[r.star] = (dist[r.star] ?? 0) + 1));

  const support = rows.filter((r) => THEMES['対応・接客'].test(r.body));
  const noSupport = rows.filter((r) => !THEMES['対応・接客'].test(r.body));
  const trouble = rows.filter((r) => THEMES['交換・不良'].test(r.body));

  return {
    label,
    sampled: rows.length,
    starDistribution: dist,
    replied: rows.filter((r) => r.shopReply).length,
    replyRate: Number(((rows.filter((r) => r.shopReply).length / n) * 100).toFixed(1)),
    themes,
    supportEffect: {
      mentioned: support.length,
      mentionedAvg: support.length ? Number(avg(support).toFixed(3)) : null,
      notMentioned: noSupport.length,
      notMentionedAvg: noSupport.length ? Number(avg(noSupport).toFixed(3)) : null,
    },
    troubleEffect: {
      count: trouble.length,
      avg: trouble.length ? Number(avg(trouble).toFixed(2)) : null,
      fourPlus: trouble.filter((r) => r.star >= 4).length,
      fourPlusShare: trouble.length
        ? Number(((trouble.filter((r) => r.star >= 4).length / trouble.length) * 100).toFixed(1))
        : null,
    },
    lowStars: rows
      .filter((r) => r.star <= 3)
      .map((r) => ({ star: r.star, date: r.date, body: r.body.slice(0, 220) })),
  };
}

async function main() {
  const pages = Number(arg('pages', '6'));
  console.log(`レビューを取得します（各${pages}ページ・1ページ30件）…`);

  const shop = await fetchShopReviews(pages);
  console.log(`  ショップレビュー: ${shop.length}件`);

  const itemIds = configuredItemIds();
  let item = [];
  for (const id of itemIds) {
    const rows = await fetchItemReviews(id, pages);
    console.log(`  商品レビュー(${id}): ${rows.length}件`);
    item = item.concat(rows);
  }

  console.log('  公式の集計値を読み取り中…');
  const shopStats = await fetchOfficialStats(shopReviewUrl(1));
  const itemStats = itemIds.length ? await fetchOfficialStats(itemReviewUrl(itemIds[0], 1)) : null;

  const out = {
    generatedAt: new Date().toISOString(),
    official: { shop: shopStats, item: itemStats },
    shop: analyzeSet(shop, 'ショップレビュー'),
    item: analyzeSet(item, '商品レビュー'),
    combined: analyzeSet([...shop, ...item], '合計'),
  };

  const p = path.join(ROOT, 'out', 'review-analysis.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 1), 'utf8');

  console.log(`\n✅ 書き出しました: ${p}`);
  if (shopStats) console.log(`  ショップ: ★${shopStats.average}（${shopStats.total.toLocaleString('ja-JP')}件）`);
  if (itemStats) console.log(`  商品　　: ★${itemStats.average}（${itemStats.total.toLocaleString('ja-JP')}件）`);
  console.log(`  本文を読んだ件数: ${out.combined.sampled}件`);
  console.log(`  返信率: ショップ ${out.shop.replyRate}% / 商品 ${out.item.replyRate}%`);
}

main().catch((e) => {
  console.error('分析エラー:', e.message);
  process.exit(1);
});
