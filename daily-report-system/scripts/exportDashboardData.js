// ============================================================
//  ダッシュボード用データの書き出し
// ------------------------------------------------------------
//  Kintone の売上アプリ（ID 7）から日次データを取り出し、
//  ダッシュボードが読める1つのJSONにまとめます。
//
//  実行:
//    npm run dashboard:data
//    npm run dashboard:data -- --out=/path/to/data.json
//
//  ★出力先は既定で out/ 配下（.gitignore 済み）。
//    実際の売上が入るため、絶対にコミットしないこと。
//
//  ※ Kintone は読むだけ。一切変更しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchSalesApp, extractDailyRows, findTextDateMismatches } from '../lib/kintoneSalesDaily.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** 商品名の対応表を読み、別名 → 正式名 の辞書にする */
function loadAliases() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'product-aliases.json'), 'utf8'));
  const toCanonical = new Map();
  const groupOf = new Map();
  for (const p of cfg.products) {
    groupOf.set(p.canonical, p.group);
    for (const a of p.aliases) toCanonical.set(a, p.canonical);
  }
  return { toCanonical, groupOf };
}

function canon(name, toCanonical) {
  return toCanonical.get(name) ?? name;
}

async function main() {
  const outPath = arg('out') ? path.resolve(arg('out')) : path.join(ROOT, 'out', 'dashboard-data.json');

  console.log('Kintone 売上アプリからデータを取得します…');
  const app = await fetchSalesApp();
  const rows = extractDailyRows(app);
  console.log(`  日次データ: ${rows.length}件（${rows[0]?.date} 〜 ${rows.at(-1)?.date}）`);

  const { toCanonical, groupOf } = loadAliases();

  // ── チャネル定義 ──
  const CHANNELS = [
    { key: 'rakuten', label: '楽天' },
    { key: 'amazon', label: 'Amazon' },
    { key: 'shopify', label: 'Shopify(自社)' },
    { key: 'tiktok', label: 'TikTok Shop' },
  ];

  // ── 日次系列 ──
  const daily = rows.map((r) => {
    const unitsByChannel = {};
    let unitsTotal = 0;
    for (const [ch, items] of Object.entries(r.units)) {
      const sum = Object.values(items).reduce((s, v) => s + v, 0);
      unitsByChannel[ch] = sum;
      unitsTotal += sum;
    }
    return {
      date: r.date,
      sales: {
        rakuten: r.sales.rakuten,
        amazon: r.sales.amazon,
        own: r.sales.own,
        total: r.sales.total ?? r.sales.rakuten + r.sales.amazon + r.sales.own,
      },
      units: unitsByChannel,
      unitsTotal,
      access: {
        rakuten: r.metrics?.rakuten?.access ?? null,
        amazon: r.metrics?.amazon?.access ?? null,
      },
      cvr: {
        rakuten: r.metrics?.rakuten?.cvr ?? null,
        amazon: r.metrics?.amazon?.cvr ?? null,
      },
      favorites: r.metrics?.rakuten?.fav ?? null,
      stayTime: r.metrics?.rakuten?.stay ?? null,
      hasUnits: Object.keys(r.units).length > 0,
    };
  });

  // ── 商品別（日次・チャネル別の個数と転換率）──
  const products = new Map(); // 正式名 → { name, group, units: {ch: {date: qty}}, cvr: {ch: {date: %}}, rank: {mall:{date:rank}} }

  const ensure = (name) => {
    if (!products.has(name)) {
      products.set(name, {
        name,
        group: groupOf.get(name) ?? '未分類',
        units: {},
        cvr: {},
        rank: {},
        totalUnits: 0,
      });
    }
    return products.get(name);
  };

  for (const r of rows) {
    for (const [ch, items] of Object.entries(r.units)) {
      for (const [rawName, qty] of Object.entries(items)) {
        const p = ensure(canon(rawName, toCanonical));
        p.units[ch] ??= {};
        p.units[ch][r.date] = (p.units[ch][r.date] ?? 0) + qty;
        p.totalUnits += qty;
      }
    }
    for (const [ch, items] of Object.entries(r.productCvr)) {
      for (const [rawName, v] of Object.entries(items)) {
        const p = ensure(canon(rawName, toCanonical));
        p.cvr[ch] ??= {};
        p.cvr[ch][r.date] = v;
      }
    }
    for (const item of r.ranking) {
      const p = ensure(canon(item.product, toCanonical));
      const ch = item.mall === '楽天' ? 'rakuten' : 'amazon';
      p.rank[ch] ??= {};
      p.rank[ch][r.date] = item.outOfRank ? null : item.rank;
    }
  }

  const productList = [...products.values()].sort((a, b) => b.totalUnits - a.totalUnits);

  // ── データの不備 ──
  const issues = findTextDateMismatches(rows).map((m) => m.detail);
  const noUnitDays = daily.filter((d) => !d.hasUnits).map((d) => d.date);
  if (noUnitDays.length) {
    issues.push(`販売個数の記載が無い日: ${noUnitDays.length}日（${noUnitDays.slice(0, 5).map((d) => d.slice(5)).join(', ')}${noUnitDays.length > 5 ? ' ほか' : ''}）`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Kintone 売上・転換率報告アプリ (ID 7)',
    period: { from: rows[0]?.date ?? null, to: rows.at(-1)?.date ?? null },
    channels: CHANNELS,
    daily,
    products: productList,
    issues,
    // まだ Kintone にアプリが無いため空。作成後にここへ入る。
    inventory: null,
    adCosts: null,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(`✅ 書き出しました: ${outPath}`);
  console.log(`   日数 ${daily.length} / 商品 ${productList.length} / 指摘 ${issues.length}件`);
  console.log(`   上位商品: ${productList.slice(0, 5).map((p) => `${p.name}(${p.totalUnits})`).join(' / ')}`);
}

main().catch((e) => {
  console.error('書き出しエラー:', e.message);
  process.exit(1);
});
