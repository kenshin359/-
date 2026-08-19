#!/usr/bin/env node
// ============================================================
//  デイリーニュース用: 昨日の転換率を日報アプリから取り出す
// ------------------------------------------------------------
//  out/news-cvr.json に書き出すだけ（newsDaily.py が読みます）。
//  日報が未入力の日は null のまま＝ニュースには「データ待ち」と出ます。
//  ★読むだけ・書き込みなし。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSalesApp, extractDailyRows } from '../lib/kintoneSalesDaily.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function targetISO() {
  const hit = process.argv.find((a) => a.startsWith('--date='));
  if (hit) return hit.slice(7);
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

async function main() {
  const iso = targetISO();
  let out = { date: iso, rakutenAccess: null, rakutenCvr: null, amazonAccess: null, amazonCvr: null };
  try {
    const app = await fetchSalesApp();
    const rows = extractDailyRows(app);
    const row = rows.find((r) => r.date === iso);
    if (row?.metrics) {
      out.rakutenAccess = row.metrics.rakuten?.access ?? null;
      out.rakutenCvr = row.metrics.rakuten?.cvr ?? null;
      out.amazonAccess = row.metrics.amazon?.access ?? null;
      out.amazonCvr = row.metrics.amazon?.cvr ?? null;
    }
  } catch (e) {
    console.warn(`⚠ 日報の読み取りに失敗（転換率はデータ待ち表示になります）: ${e.message}`);
  }
  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'out', 'news-cvr.json'), JSON.stringify(out));
  console.log(`✅ out/news-cvr.json（${iso}）`);
}

main();
