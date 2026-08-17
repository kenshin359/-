// STORES はプランによって公式APIが限られるため、CSVエクスポートを取り込む方式。
// data/stores/ に置いた STORES の売上CSV（複数可）を読み、指定日の売上を合算する。
//
// CSVの列名はショップにより異なるため環境変数で指定できる（無ければ候補から自動推定）:
//   STORES_CSV_DIR         … 既定 data/stores
//   STORES_DATE_COLUMN     … 日付列の見出し（例: 注文日 / 売上日 / date）
//   STORES_AMOUNT_COLUMN   … 金額列の見出し（例: 合計 / 売上 / total）
import fs from 'node:fs';
import path from 'node:path';

const DATE_CANDIDATES = ['注文日', '売上日', '受注日', '日付', 'date', 'Date', 'created_at'];
const AMOUNT_CANDIDATES = ['合計', '合計金額', '売上', '売上金額', '総額', 'total', 'amount', '金額'];

// ダブルクォート対応の最小CSVパーサ
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

function pick(headers, envName, candidates) {
  const explicit = process.env[envName];
  if (explicit) {
    const idx = headers.indexOf(explicit);
    if (idx >= 0) return idx;
  }
  for (const cand of candidates) {
    const idx = headers.indexOf(cand);
    if (idx >= 0) return idx;
  }
  return -1;
}

// "2026/08/01", "2026-8-1 12:30" などを "2026-08-01" に正規化
function normDate(s) {
  const m = String(s).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function toNumber(s) {
  const n = parseFloat(String(s).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function getDailyFromCsv(date) {
  const dir = process.env.STORES_CSV_DIR || path.join('data', 'stores');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'));
  if (files.length === 0) return null;

  let sales = 0;
  let matched = 0;
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '');
    const rows = parseCsv(raw);
    if (rows.length < 2) continue;
    const headers = rows[0];
    const di = pick(headers, 'STORES_DATE_COLUMN', DATE_CANDIDATES);
    const ai = pick(headers, 'STORES_AMOUNT_COLUMN', AMOUNT_CANDIDATES);
    if (di < 0 || ai < 0) continue;
    for (const r of rows.slice(1)) {
      if (normDate(r[di]) === date) {
        sales += toNumber(r[ai]);
        matched += 1;
      }
    }
  }
  if (matched === 0) return null; // その日のデータが無ければ触らない
  return { sales_stores: Math.round(sales), _stores_rows: matched };
}
