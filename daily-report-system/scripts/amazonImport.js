#!/usr/bin/env node
// ============================================================
//  Amazonの売上を、自動でキントーンに入れる
// ------------------------------------------------------------
//  CSVのダウンロードは要りません。SP-API から直接取ってきます。
//
//  実行:
//    npm run amazon:import                      … 昨日ぶん
//    npm run amazon:import -- --date=2026-07-31 … 指定した1日
//    npm run amazon:import -- --from=2026-07-01 --to=2026-07-31
//    npm run amazon:import -- --dry-run         … 書き込まず内容だけ表示
//
//  ★何度実行しても二重になりません。
//    その日の「Amazon」ぶんだけを入れ替えます（楽天・自社サイトは残ります）。
//
//  ★レポートの読み方（列名の対応・キャンセル除外・文字コード判定）は
//    CSV提出ボックスと同じ readSalesReport を使います。
//    手でCSVを置いても、APIで取っても、同じ結果になります。
// ============================================================
import { fetchOrdersReport } from '../lib/spapi.js';
import { readSalesReport, aggregateByProduct, loadSkuMap } from '../lib/salesDetail.js';
import { salesAppId, upsertDay } from '../lib/salesDetailWrite.js';
import { yen } from '../lib/salesValues.js';
import { pushChatwork } from '../lib/chatwork.js';
import { optional } from '../lib/env.js';
import { yesterdayISO, resolveRange } from './shopifyImport.js';

const CHANNEL = 'Amazon';

const isDry = process.argv.includes('--dry-run');

/** 取込結果をChatworkに知らせる（毎朝のリスト）。失敗しても取込は止めない */
async function notifyResult({ dates, agg, orderCount, unmapped }) {
  const roomId = optional('CHATWORK_SALES_ROOM_ID') || optional('CHATWORK_ROOM_ID');
  if (!roomId || !optional('CHATWORK_API_TOKEN')) return;

  for (const d of dates) {
    const dayRows = agg.filter((r) => r.date === d).sort((a, b) => b.amount - a.amount);
    const total = dayRows.reduce((s, r) => s + r.amount, 0);
    const qty = dayRows.reduce((s, r) => s + r.qty, 0);

    const lines = [
      `[info][title]📦 Amazon売上 ${d}[/title]`,
      `売上 ${yen(total)} ／ ${qty}個${orderCount ? ` ／ 注文 ${orderCount}件` : ''}`,
      '',
      ...dayRows.map((r) => {
        const mark = r.confidence === '確定' ? '' : '（要確認）';
        return `・${r.product}${mark} ×${r.qty} ${yen(r.amount)}`;
      }),
    ];
    if (unmapped.length) {
      lines.push('');
      lines.push(`⚠ 対応表に無いSKUが ${unmapped.length}件あります（「未分類・要確認」で記録）`);
    }
    lines.push('');
    lines.push('※ キントーン「売上明細（自動取込）」に登録済みです。');
    lines.push('[/info]');

    try {
      await pushChatwork(lines.join('\n'), { roomId });
      console.log(`  Chatwork（ルーム ${roomId}）に通知しました`);
    } catch (e) {
      console.warn(`  ⚠ Chatworkへの通知に失敗（取込は完了しています）: ${e.message}`);
    }
  }
}

async function main() {
  const { from, to } = resolveRange();
  const app = salesAppId({ allowMissing: isDry });
  const skuMap = loadSkuMap();

  console.log(`Amazon から ${from} 〜 ${to} の注文レポートを取ってきます …`);
  console.log(`SKU対応表: ${skuMap.size}件 登録済み`);

  const buf = await fetchOrdersReport(from, to);

  const report = readSalesReport(buf, { channel: CHANNEL });
  if (!report.ok) throw new Error(`レポートを読めませんでした: ${report.reason}`);

  // レポートには期間の前後の注文が混ざることがあるため、日付で絞る
  const rows = report.rows.filter((r) => r.date >= from && r.date <= to);

  console.log(`\n明細 ${rows.length}行（文字コード: ${report.encoding}）`);
  if (report.skipped.cancelled) console.log(`  キャンセルされた注文を除外: ${report.skipped.cancelled}件`);

  if (!rows.length) {
    console.log('\nこの期間の注文はありませんでした。');
    return;
  }

  const { rows: agg, unmapped, dates } = aggregateByProduct(rows, skuMap);
  const total = agg.reduce((s, r) => s + r.amount, 0);
  const qty = agg.reduce((s, r) => s + r.qty, 0);
  const sure = agg.filter((r) => r.confidence === '確定');
  const orderCount = new Set(rows.map((r) => r.orderId).filter(Boolean)).size;

  console.log(`売上 ${yen(total)} ／ ${qty}個${orderCount ? ` ／ 注文 ${orderCount}件` : ''}`);
  console.log(`紐づけ確定 ${sure.length}件 ／ 要確認 ${agg.length - sure.length}件\n`);

  for (const d of dates) {
    const dayRows = agg.filter((r) => r.date === d);
    const dayTotal = dayRows.reduce((s, r) => s + r.amount, 0);
    const log = [
      `取込日時: ${new Date().toLocaleString('ja-JP')}`,
      '取得元: Amazon SP-API（自動連携）',
      `販売先: ${CHANNEL}`,
      `${dayRows.length}商品 / ${yen(dayTotal)}`,
    ].join('\n');
    const action = await upsertDay(app, d, CHANNEL, dayRows, log, {
      dry: isDry,
      source: 'API自動連携',
    });
    console.log(`  ${d}  ${dayRows.length}商品 ${yen(dayTotal)} を${action}`);
  }

  if (!isDry) {
    await notifyResult({ dates, agg, orderCount, unmapped });
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

if (process.argv[1] && process.argv[1].endsWith('amazonImport.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
