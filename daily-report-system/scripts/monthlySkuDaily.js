#!/usr/bin/env node
// ============================================================
//  月次の「日別×商品」と「SKU（色）別」販売数の取り出し
// ------------------------------------------------------------
//  在庫消化カレンダーなどの資料づくり用。
//  キントーン「売上明細（自動取込）」を読んで、
//    ① 日別×商品の販売個数（サブテーブルから）
//    ② SKU（色）別の月間販売個数（添付の日次CSVから）
//  をログに出力します。
//
//  出力の数字は 0-9 → A-J の文字に置き換えています。
//  （GitHub Actions がシークレットと同じ数字列を***で隠すため、
//    数値のままだと集計値が読めなくなることがあります）
//
//  実行:  npm run monthly:sku -- --month=2026-07
//  ★キントーンは読むだけ。書き込みは一切しません。
// ============================================================
import { call } from '../lib/intake.js';
import { salesAppId } from '../lib/salesDetailWrite.js';

/** 0-9 を A-J に置き換える（Actionsのシークレットマスク対策） */
export function encodeDigits(s) {
  return String(s).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);
}

/** 引用符つきCSVを行×列に分解する（日次CSVの商品名にカンマがあるため） */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** 日次CSVの行（見出し除く）を SKU別に集計する */
export function aggregateSkuRows(csvRows, into = new Map()) {
  for (const r of csvRows) {
    // 列: 日付,販売先,商品,判定,SKU,ASIN,商品名,数量,売上
    if (!r || r.length < 9 || r[0] === '日付') continue;
    const key = `${r[1]}|${r[4] || '(SKUなし)'}`;
    const qty = Number(r[7]) || 0;
    into.set(key, (into.get(key) ?? 0) + qty);
  }
  return into;
}

function resolveMonth() {
  const arg = process.argv.find((a) => a.startsWith('--month='));
  if (arg) return arg.slice('--month='.length);
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() - 1);
  return now.toISOString().slice(0, 7);
}

async function downloadFile(fileKey) {
  const base = process.env.KINTONE_BASE_URL.replace(/\/$/, '');
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  const res = await fetch(`${base}/k/v1/file.json?fileKey=${encodeURIComponent(fileKey)}`, {
    headers: { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') },
  });
  if (!res.ok) throw new Error(`file download ${res.status}`);
  return res.text();
}

async function main() {
  const month = resolveMonth();
  const app = salesAppId();
  const [y, m] = month.split('-').map(Number);
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  console.log(`${month} の日別×商品 と SKU別集計を出します …`);

  const records = [];
  for (let offset = 0; ; offset += 100) {
    const q = encodeURIComponent(
      `report_date >= "${month}-01" and report_date <= "${to}" order by report_date asc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    records.push(...(r.records ?? []));
    if ((r.records ?? []).length < 100) break;
  }
  console.log(`日次レコード: ${records.length}件`);

  // ① 日別×商品（媒体合算）
  const daily = {};
  for (const rec of records) {
    const d = rec.report_date?.value;
    if (!d) continue;
    const day = (daily[d] ??= {});
    for (const row of rec.detail?.value ?? []) {
      const v = row.value ?? {};
      const pr = v.s_product?.value ?? '不明';
      day[pr] = (day[pr] ?? 0) + Number(v.s_qty?.value ?? 0);
    }
  }

  // ② SKU別（添付CSVから。CSVが無い媒体=Amazonなどは含まれない）
  const sku = new Map();
  let files = 0;
  for (const rec of records) {
    for (const f of rec.day_files?.value ?? []) {
      try {
        const text = await downloadFile(f.fileKey);
        aggregateSkuRows(parseCsv(text), sku);
        files++;
      } catch (e) {
        console.log(`  CSV読み込み失敗 (${f.name}): ${e.message}`);
      }
    }
  }
  console.log(`読んだCSV: ${files}本`);

  console.log('\n===DAILY_B===');
  console.log(encodeDigits(JSON.stringify({ month, daily })));
  console.log('===SKU_B===');
  console.log(encodeDigits(JSON.stringify({ month, sku: Object.fromEntries(sku) })));
}

if (process.argv[1] && process.argv[1].endsWith('monthlySkuDaily.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
