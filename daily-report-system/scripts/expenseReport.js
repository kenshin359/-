#!/usr/bin/env node
// ============================================================
//  経費レポート集計（キントーン → JSON）
// ------------------------------------------------------------
//  経費管理アプリから締め期間のレコードを読み、
//  利用者別・費目別・支払方法別に集計して out/expense-report.json に書きます。
//  そのあと python3 scripts/buildExpensePdf.py でPDFにします。
//
//  実行例:
//    node scripts/expenseReport.js                       … 直近の締め期間（前月22日〜当月21日）
//    node scripts/expenseReport.js --month=2026-08       … 暦月（8/1〜8/31）
//    node scripts/expenseReport.js --start=2026-07-24 --end=2026-08-21
//
//  必要な環境変数: KINTONE_BASE_URL / KINTONE_USER / KINTONE_PASSWORD
//                  KINTONE_EXPENSE_APP_ID（経費管理アプリのID）
//  ★キントーンは読むだけ。書き込みは一切しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { required } from '../lib/env.js';
import { api, qs, authHeadersFor } from '../lib/kintone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(path.resolve(__dirname, '..'), 'out');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 締め期間を決める（カード明細に合わせて 前月22日〜当月21日） */
export function resolvePeriod({ month, start, end, today = new Date() }) {
  if (start && end) return { start, end, label: `${start} 〜 ${end}` };
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      start: `${y}-${pad(m)}-01`,
      end: `${y}-${pad(m)}-${pad(lastDay)}`,
      label: `${y}年${m}月（暦月）`,
    };
  }
  // 直近の「21日締め」: 今日が22日以降なら 当月22日を開始に含む前のサイクルではなく、
  // 前月22日〜当月21日。今日が21日以前なら 前々月22日〜前月21日。
  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  if (today.getDate() <= 21) base.setMonth(base.getMonth() - 1);
  const s = new Date(base.getFullYear(), base.getMonth() - 1, 22);
  const e = new Date(base.getFullYear(), base.getMonth(), 21);
  return { start: iso(s), end: iso(e), label: `${iso(s)} 〜 ${iso(e)}（21日締め）` };
}

async function fetchExpenses(app, start, end) {
  const all = [];
  let lastId = 0;
  for (;;) {
    const query =
      `expense_date >= "${start}" and expense_date <= "${end}" and $id > ${lastId} ` +
      `order by $id asc limit 500`;
    const res = await api('GET', `/k/v1/records.json?${qs({ app, query })}`, null);
    const records = res.records ?? [];
    if (!records.length) break;
    all.push(...records);
    lastId = Number(records[records.length - 1].$id.value);
    if (records.length < 500) break;
  }
  return all;
}

const val = (r, code) => r[code]?.value ?? '';

/** 領収書・明細の添付ファイルをダウンロードして保存する（PDFに載せる用） */
async function downloadReceipts(records, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const baseUrl = required('KINTONE_BASE_URL').replace(/\/$/, '');
  const headers = { ...authHeadersFor(null) };
  const saved = {}; // recordId -> [{path, name, contentType}]

  for (const r of records) {
    const files = r.receipt?.value ?? [];
    const id = r.$id.value;
    for (const [i, f] of files.entries()) {
      try {
        const res = await fetch(
          `${baseUrl}/k/v1/file.json?fileKey=${encodeURIComponent(f.fileKey)}`,
          { headers }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = path.extname(f.name || '') || '.bin';
        const dest = path.join(destDir, `r${id}_${i}${ext}`);
        fs.writeFileSync(dest, buf);
        (saved[id] ??= []).push({ path: dest, name: f.name, contentType: f.contentType });
      } catch (e) {
        console.warn(`  ⚠ 添付の取得に失敗（record ${id} / ${f.name}）: ${e.message}`);
      }
    }
  }
  return saved;
}

function aggregate(records, receiptsById = {}) {
  const byMember = {};
  const byCategory = {};
  const byMethod = {};
  const rows = [];
  let total = 0;

  for (const r of records) {
    const amount = Number(val(r, 'amount') || 0);
    const member = val(r, 'member') || '（未入力）';
    const category = val(r, 'category') || '（未入力）';
    const method = val(r, 'pay_method') || '（未入力）';
    total += amount;
    byMember[member] = (byMember[member] ?? 0) + amount;
    byCategory[category] = (byCategory[category] ?? 0) + amount;
    byMethod[method] = (byMethod[method] ?? 0) + amount;
    rows.push({
      date: val(r, 'expense_date'),
      member,
      method,
      category,
      amount,
      payee: val(r, 'payee'),
      detail: val(r, 'detail'),
      settled: val(r, 'settled'),
      images: receiptsById[r.$id.value] ?? [],
    });
  }

  rows.sort((a, b) => (a.member === b.member ? a.date.localeCompare(b.date) : a.member.localeCompare(b.member)));
  const sortDesc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return {
    total,
    count: rows.length,
    byMember: sortDesc(byMember),
    byCategory: sortDesc(byCategory),
    byMethod: sortDesc(byMethod),
    rows,
  };
}

async function main() {
  const period = resolvePeriod({
    month: arg('month', ''),
    start: arg('start', ''),
    end: arg('end', ''),
  });
  const app = required('KINTONE_EXPENSE_APP_ID');

  console.log(`経費レポート: ${period.label} を集計します …`);
  const records = await fetchExpenses(app, period.start, period.end);
  console.log(`  レコード: ${records.length}件`);

  console.log('  明細画像をダウンロード中 …');
  const receiptsById = await downloadReceipts(records, path.join(OUT_DIR, 'expense-files'));
  const nFiles = Object.values(receiptsById).reduce((n, a) => n + a.length, 0);
  console.log(`  添付: ${nFiles}枚`);

  const agg = aggregate(records, receiptsById);
  console.log(`  合計: ${agg.total.toLocaleString()}円`);

  const out = { generatedAt: new Date().toISOString(), period, ...agg };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, 'expense-report.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`  書き出し: ${dest}`);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
