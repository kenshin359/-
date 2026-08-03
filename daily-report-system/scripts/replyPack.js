#!/usr/bin/env node
// ============================================================
//  返信パックの作成（過去N日の未返信レビュー × コピペ用返信文）
// ------------------------------------------------------------
//  ショップレビューと全商品の商品レビューを取り、
//  未返信のものすべてに返信文（テンプレート方式・AI不要）を付けて
//  out/reply-pack.json に書き出します。
//  エクセル化は buildReplyPackXlsx.py、送信は sendReplyPack.js。
//
//  実行: npm run replies:pack -- --days=7
//  ★取りこぼし防止のため、期間内の全件を対象にします（上限なし）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchShopReviews,
  fetchItemReviews,
  itemsFromConfig,
} from '../lib/rakutenReviews.js';
import { loadBlocks, assembleReply, auditReply } from '../lib/replyDraft.js';
import { draftFromTemplates, assembleNegativeReply } from '../lib/replyTemplates.js';
import { callClaudeRaw, parseJsonFromModel } from '../lib/claude.js';
import { filterPending } from './reviewInbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, '..'), 'out');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const days = Number(arg('days', '7'));
  const shopPages = Number(arg('shop-pages', '10'));
  const itemPages = Number(arg('item-pages', '4'));
  const todayISO = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  const cfg = loadBlocks();
  const items = itemsFromConfig();

  console.log(`ショップレビュー（${shopPages}ページ）を読みます…`);
  const shop = await fetchShopReviews(shopPages);
  console.log(`  取得: ${shop.length}件`);

  const rows = [];
  const pendingShop = filterPending(shop, todayISO, days);
  for (const r of pendingShop) rows.push({ ...r, kind: 'ショップレビュー', product: '' });

  console.log(`商品レビュー（${items.length}商品 × ${itemPages}ページ）を読みます…`);
  for (const it of items) {
    const revs = await fetchItemReviews(it.review_id, itemPages);
    const pending = filterPending(revs, todayISO, days);
    console.log(`  ${it.product}: ${revs.length}件中 未返信${pending.length}件`);
    for (const r of pending) rows.push({ ...r, kind: '商品レビュー', product: it.product, itemCode: it.code });
  }

  // 返信文を全件に付ける。
  // ★ANTHROPIC_API_KEY があればAIがレビューごとに個別の一文を書き、
  //   無いとき・失敗したときはテンプレート文例で書く（朝の便を止めない）。
  const useAi = !!process.env.ANTHROPIC_API_KEY;
  let aiOk = 0;
  let aiFail = 0;
  const promptPath = path.join(path.resolve(__dirname, '..'), 'prompts', 'review-reply-prompt.md');
  const system = useAi && fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';
  console.log(useAi ? 'AIで個別文を作ります（失敗時はテンプレートに切替）…' : 'テンプレート方式で作ります（ANTHROPIC_API_KEY 未設定）…');

  async function draftFor(review) {
    if (useAi && system) {
      try {
        const raw = await callClaudeRaw({
          system,
          userText:
            '### 文体の見本（この言い回しに寄せてください）\n```json\n' +
            JSON.stringify(cfg.style_examples ?? [], null, 2) +
            '\n```\n\n### 事実（ここに無いことは書かないでください）\n```json\n' +
            JSON.stringify(cfg.facts, null, 2) +
            '\n```\n\n### お客様のレビュー\n' +
            `星: ${review.star}\n投稿日: ${review.date}\n本文:\n${review.body}\n`,
          maxTokens: 700,
        });
        aiOk++;
        return parseJsonFromModel(raw);
      } catch (e) {
        aiFail++;
        console.warn(`  ⚠ AI下書き失敗→テンプレートに切替（★${review.star} ${review.date}）: ${e.message}`);
      }
    }
    return draftFromTemplates(review);
  }

  const out = [];
  for (const r of rows) {
    const ai = await draftFor(r);
    const built = assembleReply(ai, r, cfg);
    // 低評価は明るい結びを使わない専用の組み立てに差し替える
    if (Number(r.star) <= 3) built.text = assembleNegativeReply(ai, cfg);
    out.push({
      kind: r.kind,
      product: r.product,
      itemCode: r.itemCode ?? '',
      date: r.date,
      star: r.star,
      who: r.who,
      body: r.body,
      reply: built.text,
      needsHuman: built.needsHuman,
      reasons: built.reasons,
      audit: auditReply(built.text),
    });
  }

  // 低評価が先、同じ星なら新しい順
  out.sort((a, b) => a.star - b.star || String(b.date).localeCompare(String(a.date)));

  const from = new Date(new Date(`${todayISO}T00:00:00Z`).getTime() - (days - 1) * 86400000)
    .toISOString().slice(0, 10).replace(/-/g, '/');
  const meta = {
    from,
    to: todayISO.replace(/-/g, '/'),
    days,
    counts: {
      total: out.length,
      shop: out.filter((r) => r.kind === 'ショップレビュー').length,
      item: out.filter((r) => r.kind === '商品レビュー').length,
      needsHuman: out.filter((r) => r.needsHuman).length,
    },
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'reply-pack.json'), JSON.stringify({ meta, rows: out }, null, 1));
  console.log(
    `\n書き出し: out/reply-pack.json\n` +
      `  合計 ${meta.counts.total}件（ショップ ${meta.counts.shop} ／ 商品 ${meta.counts.item} ／ 要確認 ${meta.counts.needsHuman}）`
  );
  if (useAi) console.log(`  AI下書き: 成功${aiOk}件 ／ テンプレートに切替${aiFail}件`);
}

if (process.argv[1] && process.argv[1].endsWith('replyPack.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
