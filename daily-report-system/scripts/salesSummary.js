// ============================================================
//  月次 売上サマリー（Kintone 売上・転換率報告アプリ ID 7 から作成）
// ------------------------------------------------------------
//  「売上・販売個数・イベント日・アクセス数・転換率」を1枚にまとめます。
//
//  取得元:
//   ・売上（楽天/Amazon/自社）… Kintone 売上報告テキスト
//   ・アクセス数・転換率（楽天/Amazon）… 同【詳細数値】欄
//   ・イベント日 … 売上が平常（中央値）の一定倍を超えた日を「推定」で抽出
//   ・販売個数 … Kintoneのテキストには無いため、注文CSVから集計（任意）
//
//  実行:
//    npm run summary                        … データがある最新月
//    npm run summary -- --month=2026-07     … 月を指定
//    npm run summary -- --month=2026-07 --csv-dir=samples/sales
//                                           … 販売個数もCSVから集計
//    npm run summary -- --month=2026-07 --spike=1.5
//                                           … イベント判定のしきい値（既定1.5倍）
//
//  出力:
//    画面に一覧表 ＋ out/売上サマリー_<月>.csv / .json を書き出し
//
//  ※ Kintone は読むだけ。一切変更しません。集計はすべてJS側で行います。
// ============================================================
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  fetchSalesRecords,
  extractDailySales,
  filterByMonth,
  latestMonth,
  salesAppId,
} from '../lib/kintoneSales.js';
import { median } from '../lib/monthlySalesReport.js';

// ── 引数 ──
function arg(name, fallback = undefined) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const yen = (x) => '¥' + Math.round(Number(x) || 0).toLocaleString('ja-JP');
const pct = (x) => (x === null || x === undefined ? '—' : `${Number(x).toFixed(2)}%`);
const numOr = (x) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('ja-JP'));

// ── 販売個数（任意）：注文CSVから日別・チャネル別の個数を集計 ──
async function unitsFromCsv(csvDir, ym) {
  const dir = path.resolve(process.cwd(), csvDir);
  if (!existsSync(dir)) {
    console.warn(`  ⚠️ CSVフォルダが見つかりません: ${dir}（販売個数はスキップ）`);
    return null;
  }
  const { aggregateFile } = await import('../lib/salesAggregate.js');
  const mapping = JSON.parse(readFileSync(path.resolve(process.cwd(), 'config/sales-mapping.json'), 'utf8'));

  const files = readdirSync(dir).filter((f) => /\.(csv|tsv)$/i.test(f));
  const byDate = {}; // date -> { rakuten, amazon, own }
  for (const name of files) {
    const buffer = readFileSync(path.join(dir, name));
    const r = aggregateFile({ name, buffer }, mapping);
    if (!r.ok || r.kind === 'ad') continue;
    const bucket = r.channelId === 'rakuten' ? 'rakuten' : r.channelId === 'amazon' ? 'amazon' : 'own';
    for (const [date, d] of Object.entries(r.daily)) {
      if (!date.startsWith(ym)) continue;
      byDate[date] = byDate[date] || { rakuten: 0, amazon: 0, own: 0 };
      byDate[date][bucket] += d.units || 0;
    }
  }
  return byDate;
}

async function main() {
  console.log(`売上アプリ(ID ${salesAppId()})からデータを取得します…`);
  const records = await fetchSalesRecords();
  const allRows = extractDailySales(records);
  if (!allRows.length) {
    console.log('売上データが取得できませんでした。認証情報（.env）と KINTONE_SALES_APP_ID をご確認ください。');
    return;
  }

  const ym = arg('month') || latestMonth(allRows);
  const spikeRatio = Number(arg('spike') || '1.5');
  const csvDir = arg('csv-dir');
  const rows = filterByMonth(allRows, ym);
  if (!rows.length) {
    console.log(`${ym} のデータがありません。--month= を確認してください（例: --month=2026-07）。`);
    console.log(`データがある月: ${[...new Set(allRows.map((r) => r.date.slice(0, 7)))].join(', ')}`);
    return;
  }

  // 同一日が複数レコードに跨る場合の合算
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.date) || {
      date: r.date, rakuten: 0, amazon: 0, own: 0, total: 0,
      rkAccess: null, rkCvr: null, azAccess: null, azCvr: null, count: 0,
    };
    cur.rakuten += r.rakuten; cur.amazon += r.amazon; cur.own += r.own; cur.total += r.total;
    // 指標は最初に見つかった値を採用（1日1報告が基本）
    if (cur.rkAccess === null) cur.rkAccess = r.metrics?.rakuten?.access ?? null;
    if (cur.rkCvr === null) cur.rkCvr = r.metrics?.rakuten?.cvr ?? null;
    if (cur.azAccess === null) cur.azAccess = r.metrics?.amazon?.access ?? null;
    if (cur.azCvr === null) cur.azCvr = r.metrics?.amazon?.cvr ?? null;
    cur.count += 1;
    map.set(r.date, cur);
  }
  const days = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));

  // 販売個数（任意）
  let units = null;
  if (csvDir) units = await unitsFromCsv(csvDir, ym);

  // イベント日（推定）：合算が無い日で、中央値×spikeRatio 以上を抽出
  const reliable = days.filter((d) => d.count === 1);
  const med = median(reliable.map((d) => d.total)) || 0;
  for (const d of days) {
    d.isEvent = med > 0 && d.count === 1 && d.total >= med * spikeRatio;
    d.ratio = med > 0 ? d.total / med : null;
    if (units && units[d.date]) {
      d.rkUnits = units[d.date].rakuten;
      d.azUnits = units[d.date].amazon;
      d.ownUnits = units[d.date].own;
      d.units = d.rkUnits + d.azUnits + d.ownUnits;
    }
  }

  // 月次合計
  const sum = (k) => days.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const totals = {
    rakuten: sum('rakuten'), amazon: sum('amazon'), own: sum('own'), total: sum('total'),
    units: units ? sum('units') : null,
  };
  const dayCount = days.length;

  // ── 画面表示 ──
  console.log(`\n===== ${ym} 売上サマリー（${dayCount}日分・中央値 ${yen(med)}）=====\n`);
  console.log('日付        ｜ 合計         ｜ 楽天         ｜ Amazon       ｜ 自社         ｜ 楽AC/転  ｜ AzAC/転 ｜ 個数 ｜ 印');
  for (const d of days) {
    const mark = d.isEvent ? `★${d.ratio ? d.ratio.toFixed(1) + '倍' : ''}` : '';
    const u = d.units != null ? String(d.units) : '—';
    console.log(
      `${d.date} ｜ ${yen(d.total).padStart(11)} ｜ ${yen(d.rakuten).padStart(11)} ｜ ${yen(d.amazon).padStart(11)} ｜ ${yen(d.own).padStart(11)} ｜ ` +
        `${numOr(d.rkAccess)}/${pct(d.rkCvr)} ｜ ${numOr(d.azAccess)}/${pct(d.azCvr)} ｜ ${u.padStart(4)} ｜ ${mark}`
    );
  }
  console.log('\n--- 月次合計 ---');
  console.log(`合計売上 ${yen(totals.total)}（楽天 ${yen(totals.rakuten)} / Amazon ${yen(totals.amazon)} / 自社 ${yen(totals.own)}）`);
  if (totals.units != null) console.log(`販売個数 合計 ${totals.units.toLocaleString('ja-JP')}個`);
  const eventDays = days.filter((d) => d.isEvent);
  console.log(`イベント（推定）日数: ${eventDays.length}日` + (eventDays.length ? ` → ${eventDays.map((d) => `${d.date.slice(5)}(${d.ratio.toFixed(1)}倍)`).join(', ')}` : ''));
  if (!csvDir) console.log('※ 販売個数を出すには --csv-dir=<注文CSVのフォルダ> を付けてください。');

  // ── ファイル出力（Excelで開けるCSV / 分析用JSON）──
  mkdirSync('out', { recursive: true });
  const header = ['日付','合計売上','楽天売上','Amazon売上','自社売上','楽天アクセス','楽天転換率(%)','Amazonアクセス','Amazon転換率(%)','販売個数','イベント推定','平常比(倍)'];
  const lines = [header.join(',')];
  for (const d of days) {
    lines.push([
      d.date, Math.round(d.total), Math.round(d.rakuten), Math.round(d.amazon), Math.round(d.own),
      d.rkAccess ?? '', d.rkCvr ?? '', d.azAccess ?? '', d.azCvr ?? '',
      d.units ?? '', d.isEvent ? 'イベント' : '', d.ratio ? d.ratio.toFixed(2) : '',
    ].join(','));
  }
  lines.push(['合計', Math.round(totals.total), Math.round(totals.rakuten), Math.round(totals.amazon), Math.round(totals.own), '', '', '', '', totals.units ?? '', '', ''].join(','));
  const csvPath = `out/売上サマリー_${ym}.csv`;
  writeFileSync(csvPath, '﻿' + lines.join('\n')); // BOM付きでExcel文字化け防止
  const jsonPath = `out/売上サマリー_${ym}.json`;
  writeFileSync(jsonPath, JSON.stringify({ month: ym, dayCount, median: med, totals, eventDays: eventDays.map((d) => d.date), days }, null, 2));
  console.log(`\n書き出しました: ${csvPath} / ${jsonPath}`);
}

main().catch((e) => {
  console.error('売上サマリー エラー:', e.detail || e.message);
  process.exit(1);
});
