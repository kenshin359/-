#!/usr/bin/env node
// ============================================================
//  売上レポートを読んで、商品ごとに紐づけて取り込む
// ------------------------------------------------------------
//  「日次CSV提出ボックス」に置かれた売上CSV、または手元のファイルを読み、
//  商品ごとにまとめて「売上明細（自動取込）」アプリへ入れます。
//
//  実行:
//    npm run sales:import                    … 提出ボックスの今日ぶん
//    npm run sales:import -- --date=2026-07-31
//    npm run sales:import -- --dry-run       … 書き込まず内容だけ表示
//    npm run sales:import -- --file=path.csv --channel=Amazon
//
//  ★--dry-run では「まだ対応表に無いSKU」が一覧で出ます。
//    それを config/sku-map.json に足すと、次回から『確定』になります。
//
//  ★売上・転換率報告アプリ（人が手で入力）には一切書き込みません。
// ============================================================
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { checkDay, downloadFile, intakeAppId } from '../lib/intake.js';
import { SALES_SLOTS } from '../kintone/intakeSchema.js';
import { readSalesReport, aggregateByProduct, loadSkuMap } from '../lib/salesDetail.js';
import { looksLikeStoreDaily, readStoreDaily, summarizeStoreDaily } from '../lib/rakutenStore.js';
import { NO_BREAKDOWN } from '../kintone/salesDetailSchema.js';
import { salesAppId, upsertDay as writeDay } from '../lib/salesDetailWrite.js';
import { yen } from '../lib/salesValues.js';
import { todayISO } from '../lib/date.js';

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const isDry = process.argv.includes('--dry-run');

/** 取り込む対象のファイルを集める（提出ボックス or 手元のファイル） */
async function collectFiles(date) {
  const file = arg('file');
  if (file) {
    const channel = arg('channel') || 'Amazon';
    return [{ name: basename(file), buffer: readFileSync(file), channel }];
  }

  const check = await checkDay(date, intakeAppId());
  if (!check.exists) {
    console.log(`${date} の提出ボックスにレコードがありません。`);
    return [];
  }
  const out = [];
  for (const slot of SALES_SLOTS) {
    const s = check.slots.find((x) => x.code === slot.code);
    if (!s?.filled) continue;
    for (const f of s.files) {
      out.push({ name: f.name, buffer: await downloadFile(f.fileKey), channel: slot.channel });
    }
  }
  return out;
}

/**
 * 店舗全体の日次データ（商品別の内訳が無いファイル）を取り込む。
 * ★売れた商品は分からないので、分からないと書きます。推測はしません。
 */
async function importStoreDaily(app, f) {
  const parsed = readStoreDaily(f.buffer);
  if (!parsed.ok) {
    console.log(`  ⚠ 読めませんでした: ${parsed.reason}`);
    return;
  }
  const s = summarizeStoreDaily(parsed);
  console.log(`  文字コード ${parsed.encoding} ／ 店舗全体の日次データ（商品別の内訳なし）`);
  console.log(`  期間 ${parsed.rows[0]?.date} 〜 ${parsed.rows.at(-1)?.date}（${s.days}日）`);
  console.log(`  売上 ${yen(s.total)} ／ ${s.orders}件 ／ アクセス ${s.access.toLocaleString()}人`);
  console.log(`  転換率 ${s.cvr.toFixed(2)}% ／ 客単価 ${yen(s.aov)}`);
  if (parsed.skippedDeviceRows) {
    console.log(`  ※ デバイス別の行 ${parsed.skippedDeviceRows}件は「すべて」と重複するため除外しました`);
  }
  console.log('  ※ どの商品が売れたかは、このファイルには入っていません。');
  console.log('     商品別が必要な場合は RMS の「商品別データ」をダウンロードしてください。');

  for (const r of parsed.rows) {
    const row = {
      date: r.date,
      channel: f.channel,
      product: NO_BREAKDOWN,
      confidence: '要確認',
      sku: '',
      asin: '',
      title: '店舗全体の日次データ',
      qty: 0,
      amount: r.amount,
      orders: r.orders,
    };
    const log = [
      `取込日時: ${new Date().toLocaleString('ja-JP')}`,
      `元ファイル: ${f.name}`,
      `販売先: ${f.channel}（店舗全体の日次データ）`,
      `売上 ${yen(r.amount)} / ${r.orders}件 / アクセス ${r.access}人 / 転換率 ${r.cvr}% / 客単価 ${yen(r.aov)}`,
      '商品別の内訳はこのファイルに含まれていません。',
    ].join('\n');
    const action = await writeDay(app, r.date, f.channel, [row], log, { dry: isDry });
    console.log(`    ${r.date}  ${yen(r.amount)}（${r.orders}件）を${action}`);
  }
}

async function main() {
  const date = arg('date') || todayISO();
  const app = salesAppId({ allowMissing: isDry });
  const skuMap = loadSkuMap();

  console.log(`SKU対応表: ${skuMap.size}件 登録済み`);

  const files = await collectFiles(date);
  if (!files.length) {
    console.log('読み取る売上ファイルがありませんでした。');
    return;
  }

  const allUnmapped = new Map();

  for (const f of files) {
    console.log(`\n▶ ${f.name}（${f.channel}）`);

    // ★楽天RMSの「日次 店舗データ」は、商品別の内訳が入っていません。
    //   金額は正しいので日ごとの合計として取り込み、
    //   商品名は「(商品別内訳なし)」と正直に書きます。
    //   あとで商品別ファイルを同じ日に入れれば、その日の楽天ぶんは差し替わります。
    if (looksLikeStoreDaily(f.buffer)) {
      await importStoreDaily(app, f);
      continue;
    }

    const parsed = readSalesReport(f.buffer, { channel: f.channel });
    if (!parsed.ok) {
      console.log(`  ⚠ 読めませんでした: ${parsed.reason}`);
      continue;
    }

    const { rows, unmapped, dates } = aggregateByProduct(parsed.rows, skuMap);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const qty = rows.reduce((s, r) => s + r.qty, 0);
    const sure = rows.filter((r) => r.confidence === '確定');

    console.log(`  文字コード ${parsed.encoding} ／ ${parsed.rows.length}行 → ${rows.length}件にまとめました`);
    console.log(`  期間 ${dates[0]} 〜 ${dates.at(-1)}（${dates.length}日）`);
    console.log(`  売上 ${yen(total)} ／ ${qty}個`);
    console.log(`  紐づけ確定 ${sure.length}件 ／ 要確認 ${rows.length - sure.length}件`);
    if (parsed.skipped.cancelled) console.log(`  キャンセル・返品を除外: ${parsed.skipped.cancelled}行`);

    for (const u of unmapped) {
      const k = u.sku || u.asin || u.title;
      if (!allUnmapped.has(k)) allUnmapped.set(k, u);
    }

    // 日ごとに分けて書き込む
    for (const d of dates) {
      const dayRows = rows.filter((r) => r.date === d);
      const dayTotal = dayRows.reduce((s, r) => s + r.amount, 0);
      const log = [
        `取込日時: ${new Date().toLocaleString('ja-JP')}`,
        `元ファイル: ${f.name}`,
        `販売先: ${f.channel}`,
        `${dayRows.length}商品 / ${yen(dayTotal)}`,
      ].join('\n');
      const action = await writeDay(app, d, f.channel, dayRows, log, { dry: isDry });
      console.log(`    ${d}  ${dayRows.length}商品 ${yen(dayTotal)} を${action}`);
    }
  }

  if (allUnmapped.size) {
    console.log('\n════════ まだ対応表に無いSKU ════════');
    console.log('下記を config/sku-map.json の entries に足すと、次回から「確定」になります。\n');
    for (const u of [...allUnmapped.values()].sort((a, b) => b.amount - a.amount)) {
      console.log(`  ${yen(u.amount).padStart(12)} ${u.qty}個  ${u.title || '(商品名なし)'}`);
      console.log(`      { "sku": "${u.sku}", "asin": "${u.asin}", "product": "${u.guess}" },`);
    }
    console.log('\n※ product の値が正しいか、必ずご確認ください（商品名からの推測です）。');
  } else {
    console.log('\n✅ すべてのSKUが対応表にあります。紐づけは全件「確定」です。');
  }
}

if (process.argv[1] && process.argv[1].endsWith('salesImport.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
