#!/usr/bin/env node
// ============================================================
//  Shopify（自社サイト）の売上を、自動でキントーンに入れる
// ------------------------------------------------------------
//  CSVのダウンロードは要りません。Shopify から直接取ってきます。
//
//  実行:
//    npm run shopify:import                      … 昨日ぶん
//    npm run shopify:import -- --date=2026-07-31 … 指定した1日
//    npm run shopify:import -- --from=2026-07-01 --to=2026-07-31
//    npm run shopify:import -- --dry-run         … 書き込まず内容だけ表示
//
//  ★何度実行しても二重になりません。
//    その日の「自社サイト」ぶんだけを入れ替えます。
//    （Amazon・楽天の明細は残ります）
//
//  ★売上・転換率報告アプリ（人が手で入力）には一切書き込みません。
// ============================================================
import { fetchOrders, ordersToRows } from '../lib/shopify.js';
import { aggregateByProduct, loadSkuMap } from '../lib/salesDetail.js';
import { salesAppId, upsertDay } from '../lib/salesDetailWrite.js';
import { yen } from '../lib/salesValues.js';
import { todayISO } from '../lib/date.js';

const CHANNEL = '自社サイト';

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const isDry = process.argv.includes('--dry-run');

/** 昨日の日付（日本時間） */
export function yesterdayISO(today = todayISO()) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** --date / --from / --to から対象期間を決める */
export function resolveRange(argv = process.argv) {
  const get = (n) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : null;
  };
  const one = get('date');
  if (one) return { from: one, to: one };
  const from = get('from');
  const to = get('to');
  if (from || to) return { from: from ?? to, to: to ?? from };
  const y = yesterdayISO();
  return { from: y, to: y };
}

async function main() {
  const { from, to } = resolveRange();
  const app = salesAppId({ allowMissing: isDry });
  const skuMap = loadSkuMap();

  console.log(`Shopify から ${from} 〜 ${to} の注文を取ってきます …`);
  console.log(`SKU対応表: ${skuMap.size}件 登録済み`);

  const orders = await fetchOrders(from, to);
  const { rows, skipped, truncatedLineItems } = ordersToRows(orders, { channel: CHANNEL });

  console.log(`\n注文 ${orders.length}件 → 明細 ${rows.length}行`);
  if (skipped.cancelled) console.log(`  キャンセルされた注文を除外: ${skipped.cancelled}件`);
  if (skipped.test) console.log(`  テスト注文を除外: ${skipped.test}件`);
  if (truncatedLineItems) {
    console.log(`  ⚠ 商品が100点を超える注文が ${truncatedLineItems}件ありました（超えたぶんは読めていません）`);
  }

  if (!rows.length) {
    console.log('\nこの期間の注文はありませんでした。');
    return;
  }

  const { rows: agg, unmapped, dates } = aggregateByProduct(rows, skuMap);
  const total = agg.reduce((s, r) => s + r.amount, 0);
  const qty = agg.reduce((s, r) => s + r.qty, 0);
  const sure = agg.filter((r) => r.confidence === '確定');

  console.log(`売上 ${yen(total)} ／ ${qty}個`);
  console.log(`紐づけ確定 ${sure.length}件 ／ 要確認 ${agg.length - sure.length}件\n`);

  for (const d of dates) {
    const dayRows = agg.filter((r) => r.date === d);
    const dayTotal = dayRows.reduce((s, r) => s + r.amount, 0);
    const log = [
      `取込日時: ${new Date().toLocaleString('ja-JP')}`,
      '取得元: Shopify Admin API（自動連携）',
      `販売先: ${CHANNEL}`,
      `${dayRows.length}商品 / ${yen(dayTotal)}`,
    ].join('\n');
    const action = await upsertDay(app, d, CHANNEL, dayRows, log, {
      dry: isDry,
      source: 'API自動連携',
    });
    console.log(`  ${d}  ${dayRows.length}商品 ${yen(dayTotal)} を${action}`);
  }

  if (unmapped.length) {
    console.log('\n════════ まだ対応表に無いSKU ════════');
    console.log('下記を config/sku-map.json の entries に足すと、次回から「確定」になります。\n');
    for (const u of unmapped.sort((a, b) => b.amount - a.amount)) {
      console.log(`  ${yen(u.amount).padStart(12)} ${u.qty}個  ${u.title || '(商品名なし)'}`);
      console.log(`      { "sku": "${u.sku}", "product": "${u.guess}" },`);
    }
    console.log('\n※ product の値が正しいか、必ずご確認ください（商品名からの推測です）。');
  } else {
    console.log('\n✅ すべてのSKUが対応表にあります。紐づけは全件「確定」です。');
  }
}

if (process.argv[1] && process.argv[1].endsWith('shopifyImport.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
