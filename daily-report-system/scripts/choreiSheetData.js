#!/usr/bin/env node
// ============================================================
//  朝礼用 進捗シートのデータ集め
// ------------------------------------------------------------
//  ・楽天/自社: キントーン「売上明細（自動取込）」から日別合計
//  ・Amazon:   毎朝KPIアプリの添付ビジネスレポートから日別売上
//              （添付がない日は config/chorei/amazon-manual-*.json で補完）
//  ・残在庫:   在庫報告アプリ（CS出荷後・ID35）の最新レコード
//  結果を out/chorei-progress.json に書き出します。読むだけ・書き込みなし。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';
import { authHeadersFor } from '../lib/kintone.js';
import { todayISO } from '../lib/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** 引用符つきCSVの1行を分解 */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s) => Number(String(s ?? '').replace(/[￥¥,"\s]/g, '')) || 0;

/** 全角数字→半角 */
const z2h = (s) => String(s).replace(/[０-９]/g, (c) => '０１２３４５６７８９'.indexOf(c));

/** ファイル名から日付(日)を推定（8.15 / 8:15 / 8月15日 など） */
export function dayFromName(name) {
  const n = z2h(name);
  const m = n.match(/8[.:：月\s]?\s*([0-3]?\d)/);
  return m ? Number(m[1]) : null;
}

/**
 * Amazonビジネスレポート系CSVから {date: 売上額} を取り出す（純関数）。
 * 形式A: 「日付」列がある日別レポート
 * 形式B: ASIN別レポート（日付はファイル名から）
 */
export function parseAmazonCsv(text, fileName, month = '2026-08') {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return {};
  const header = splitCsvLine(lines[0]);
  const iSales = header.findIndex((h) => h.includes('注文商品の売上額') && !h.includes('B2B'));
  if (iSales < 0) return {};
  const iDate = header.findIndex((h) => h.trim() === '日付');
  const out = {};
  if (iDate >= 0) {
    for (const line of lines.slice(1)) {
      const cols = splitCsvLine(line);
      const m = String(cols[iDate] ?? '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (!m) continue;
      const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      out[iso] = (out[iso] ?? 0) + num(cols[iSales]);
    }
  } else {
    const day = dayFromName(fileName);
    if (!day) return {};
    const iso = `${month}-${String(day).padStart(2, '0')}`;
    let total = 0;
    for (const line of lines.slice(1)) total += num(splitCsvLine(line)[iSales]);
    if (total > 0) out[iso] = total;
  }
  return out;
}

async function fetchChannelDaily(app, from, to) {
  const days = {};
  let offset = 0;
  for (;;) {
    const q = encodeURIComponent(
      `report_date >= "${from}" and report_date <= "${to}" order by report_date asc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    for (const rec of r.records ?? []) {
      const d = rec.report_date?.value;
      if (!d) continue;
      for (const row of rec.detail?.value ?? []) {
        const v = row.value ?? {};
        const ch = v.s_channel?.value ?? '';
        const amt = Number(v.s_amount?.value) || 0;
        days[d] = days[d] ?? { rakuten: 0, own: 0 };
        if (ch === '楽天') days[d].rakuten += amt;
        if (ch === '自社サイト') days[d].own += amt;
      }
    }
    if ((r.records ?? []).length < 100) break;
    offset += 100;
  }
  return days;
}

async function fetchAmazonFromKpi(from) {
  const appId = optional('KINTONE_KPI_APP_ID', '30');
  const base = (optional('KINTONE_BASE_URL') || '').replace(/\/$/, '');
  const q = encodeURIComponent(`report_date >= "${from}" order by report_date desc limit 40`);
  const data = await call('GET', `/k/v1/records.json?app=${appId}&query=${q}`);
  const out = {};
  for (const rec of data.records ?? []) {
    for (const field of ['file_sales', 'file_ads', 'file_other']) {
      for (const f of rec[field]?.value ?? []) {
        const name = f.name || '';
        if (!/アマゾン|amazon/i.test(name) || /広告/.test(name)) continue;
        try {
          const res = await fetch(`${base}/k/v1/file.json?fileKey=${encodeURIComponent(f.fileKey)}`, {
            headers: authHeadersFor(null),
          });
          if (!res.ok) continue;
          const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
          Object.assign(out, parseAmazonCsv(text, name));
        } catch { /* 1ファイル失敗しても続行 */ }
      }
    }
  }
  return out;
}

/** 在庫報告レコードの明細行を取り出す（純関数） */
export function parseStockRows(rec) {
  const rows = [];
  for (const row of rec?.stock_rows?.value ?? []) {
    const v = row.value ?? {};
    const qty = Number(v.st_qty?.value);
    rows.push({
      product: v.st_product?.value ?? '',
      sku: v.st_sku?.value ?? '',
      qty: Number.isFinite(qty) ? qty : 0,
      memo: v.st_memo?.value ?? '',
    });
  }
  return rows;
}

/** 在庫報告アプリ（CS出荷後）の最新レコードから残在庫を取る */
async function fetchStock() {
  const appId = optional('KINTONE_STOCK_APP_ID', '35');
  const q = encodeURIComponent('order by report_date desc limit 1');
  const data = await call('GET', `/k/v1/records.json?app=${appId}&query=${q}`);
  const rec = (data.records ?? [])[0];
  if (!rec) return null;
  return {
    reportDate: rec.report_date?.value ?? '',
    staff: rec.staff?.value ?? '',
    memo: rec.memo?.value ?? '',
    rows: parseStockRows(rec),
  };
}

async function fetchPromo(from, monthEnd) {
  const appId = optional('KINTONE_PROMO_APP_ID', '42');
  const q = encodeURIComponent(
    `cost_date >= "${from}" and cost_date <= "${monthEnd}" order by cost_date asc limit 200`
  );
  const data = await call('GET', `/k/v1/records.json?app=${appId}&query=${q}`);
  const rows = (data.records ?? []).map((rec) => ({
    date: rec.cost_date?.value ?? '',
    brand: rec.brand?.value ?? '',
    category: rec.category?.value ?? 'その他',
    amount: Number(rec.amount?.value) || 0,
    partner: rec.partner?.value ?? '',
    product: rec.product?.value ?? '',
    memo: rec.memo?.value ?? '',
  }));
  return { rows };
}

async function main() {
  const today = todayISO();
  const month = today.slice(0, 7);
  const from = `${month}-01`;
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const to = yesterday.toISOString().slice(0, 10);

  const app = optional('KINTONE_SALES_DETAIL_APP_ID');
  const channel = app ? await fetchChannelDaily(app, from, to) : {};

  let amazon = {};
  const manualPath = path.join(ROOT, 'config', 'chorei', `amazon-manual-${month}.json`);
  if (fs.existsSync(manualPath)) {
    const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
    for (const [k, v] of Object.entries(manual)) if (/^\d{4}-/.test(k)) amazon[k] = v;
  }
  try {
    Object.assign(amazon, await fetchAmazonFromKpi(from)); // 添付があれば上書き
  } catch (e) {
    console.warn(`⚠ KPI添付の読み取りに失敗（手動補完のみ使用）: ${e.message}`);
  }

  const events = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'config', 'chorei', `events-${month}.json`), 'utf8')
  );

  let stock = null;
  try {
    stock = await fetchStock();
  } catch (e) {
    console.warn(`⚠ 在庫報告の読み取りに失敗（在庫シートは空欄になります）: ${e.message}`);
  }

  // 販促費（Google/TikTok広告・案件依頼費・TV出演・PRタイムズなど）
  let promo = null;
  try {
    const [y, m] = month.split('-').map(Number);
    const monthEnd = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    promo = await fetchPromo(from, monthEnd);
  } catch (e) {
    console.warn(`⚠ 販促費の読み取りに失敗（販促費シートは案内のみになります）: ${e.message}`);
  }

  const days = {};
  for (let d = 1; d <= Number(to.slice(8, 10)); d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    days[iso] = {
      rakuten: channel[iso]?.rakuten ?? 0,
      amazon: amazon[iso] ?? 0,
      own: channel[iso]?.own ?? 0,
    };
  }

  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'chorei-progress.json'),
    JSON.stringify({ month, today, upTo: to, days, stock, promo, ...events }, null, 1)
  );
  console.log(
    `✅ out/chorei-progress.json（${Object.keys(days).length}日分・〜${to}・在庫${stock ? stock.rows.length : 0}行・販促費${promo ? promo.rows.length : 0}件）`
  );
}

const isMain = process.argv[1] && process.argv[1].endsWith('choreiSheetData.js');
if (isMain) {
  main().catch((e) => { console.error('エラー:', e.message); process.exit(1); });
}
