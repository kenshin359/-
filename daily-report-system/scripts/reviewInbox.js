#!/usr/bin/env node
// ============================================================
//  返信待ちレビューの取り出し
// ------------------------------------------------------------
//  楽天の公開レビューページから直近のショップレビューを読み、
//  「過去N日 かつ 店舗返信なし」だけを out/review-inbox.json に
//  書き出します（PDF化は buildReviewInboxPdf.py）。
//
//  実行: npm run reviews:inbox -- --days=7 --pages=8
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchShopReviews } from '../lib/rakutenReviews.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, '..'), 'out');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** 「2026/8/3」→ Date（日本時間の暦日として扱う） */
export function parseJpDate(s) {
  const [y, m, d] = String(s).split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 過去N日（今日を含む）かつ未返信のレビューだけ残す */
export function filterPending(rows, todayISO, days) {
  const today = new Date(`${todayISO}T00:00:00Z`);
  return rows.filter((r) => {
    if (r.shopReply) return false;
    const diff = (today - parseJpDate(r.date)) / 86400000;
    return diff >= 0 && diff < days;
  });
}

async function main() {
  const days = Number(arg('days', '7'));
  const pages = Number(arg('pages', '8'));
  const todayISO = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  console.log(`ショップレビューを読みます（${pages}ページ・過去${days}日・未返信のみ）…`);
  const rows = await fetchShopReviews(pages);
  console.log(`取得: ${rows.length}件`);

  const pending = filterPending(rows, todayISO, days);
  const from = new Date(new Date(`${todayISO}T00:00:00Z`).getTime() - (days - 1) * 86400000)
    .toISOString().slice(0, 10).replace(/-/g, '/');

  const low = pending.filter((r) => r.star <= 3).length;
  console.log(`未返信: ${pending.length}件（うち★3以下 ${low}件）`);

  fs.mkdirSync(OUT, { recursive: true });
  const out = {
    meta: {
      target: 'ショップレビュー',
      from,
      to: todayISO.replace(/-/g, '/'),
      days,
      generated: `${todayISO.replace(/-/g, '/')} 自動作成`,
    },
    reviews: pending,
  };
  const file = path.join(OUT, 'review-inbox.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`書き出し: ${file}`);
}

if (process.argv[1] && process.argv[1].endsWith('reviewInbox.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
