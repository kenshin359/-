#!/usr/bin/env node
// ============================================================
//  月次の販売個数まとめ（媒体×商品）
// ------------------------------------------------------------
//  キントーン「売上明細（自動取込）」を読んで、
//  指定した月の 媒体×商品 の個数・売上を一覧表示します。
//  エクセル資料づくりなどの取り出し用。
//
//  実行:
//    npm run monthly:units -- --month=2026-07
//    （省略時は先月）
//
//  ★キントーンは読むだけ。書き込みは一切しません。
// ============================================================
import { call } from '../lib/intake.js';
import { salesAppId } from '../lib/salesDetailWrite.js';
import { yen } from '../lib/salesValues.js';

function resolveMonth() {
  const arg = process.argv.find((a) => a.startsWith('--month='));
  if (arg) {
    const m = arg.slice('--month='.length);
    if (!/^\d{4}-\d{2}$/.test(m)) throw new Error(`--month は YYYY-MM 形式で指定してください: ${m}`);
    return m;
  }
  // 省略時は先月（日本時間）
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() - 1);
  return now.toISOString().slice(0, 7);
}

function lastDay(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

async function fetchMonth(app, month) {
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay(month)).padStart(2, '0')}`;
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const q = encodeURIComponent(
      `report_date >= "${from}" and report_date <= "${to}" order by report_date asc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    out.push(...(r.records ?? []));
    if ((r.records ?? []).length < 100) break;
  }
  return out;
}

async function main() {
  const month = resolveMonth();
  const app = salesAppId();
  console.log(`${month} の 媒体×商品 を集計します …`);

  const records = await fetchMonth(app, month);
  console.log(`日次レコード: ${records.length}件`);

  // channel → product → {qty, amount}
  const table = new Map();
  for (const rec of records) {
    for (const row of rec.detail?.value ?? []) {
      const v = row.value ?? {};
      const ch = v.s_channel?.value ?? '不明';
      const pr = v.s_product?.value ?? '不明';
      const qty = Number(v.s_qty?.value ?? 0);
      const amt = Number(v.s_amount?.value ?? 0);
      if (!table.has(ch)) table.set(ch, new Map());
      const m = table.get(ch);
      if (!m.has(pr)) m.set(pr, { qty: 0, amount: 0 });
      m.get(pr).qty += qty;
      m.get(pr).amount += amt;
    }
  }

  for (const [ch, prods] of table) {
    let q = 0;
    let a = 0;
    console.log(`\n【${ch}】`);
    for (const [pr, v] of [...prods.entries()].sort((x, y) => y[1].amount - x[1].amount)) {
      console.log(`  ${pr}  ×${v.qty}  ${yen(v.amount)}`);
      q += v.qty;
      a += v.amount;
    }
    console.log(`  合計  ×${q}  ${yen(a)}`);
  }

  // 機械読み取り用（1行JSON）
  const json = {};
  for (const [ch, prods] of table) {
    json[ch] = {};
    for (const [pr, v] of prods) json[ch][pr] = { qty: v.qty, amount: v.amount };
  }
  console.log('\n===UNITS_JSON===');
  console.log(JSON.stringify({ month, channels: json }));
}

if (process.argv[1] && process.argv[1].endsWith('monthlyUnits.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
