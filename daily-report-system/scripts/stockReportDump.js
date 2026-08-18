#!/usr/bin/env node
// ============================================================
//  在庫報告（CS出荷後）の取り出し
// ------------------------------------------------------------
//  CSチームが入力した「商品ごとの残り在庫数」をログに出力します。
//  読むだけ・書き込みなし。
//
//  出力の数字は 0-9 → A-J（Actionsのシークレットマスク対策・可逆）。
//
//  実行: node scripts/stockReportDump.js --days=14
// ============================================================
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

export const encodeDigits = (s) => String(s).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);

async function main() {
  const days = Number(arg('days', '14'));
  const app = optional('KINTONE_STOCK_REPORT_APP_ID') || arg('app', '');
  if (!app) throw new Error('KINTONE_STOCK_REPORT_APP_ID か --app=番号 を指定してください');

  const since = new Date(Date.now() + 9 * 3600 * 1000);
  since.setUTCDate(since.getUTCDate() - days);
  const sinceISO = since.toISOString().slice(0, 10);

  const records = [];
  for (let offset = 0; ; offset += 100) {
    const q = encodeURIComponent(
      `report_date >= "${sinceISO}" order by report_date desc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    records.push(...(r.records ?? []));
    if ((r.records ?? []).length < 100) break;
  }
  console.log(`対象レコード: ${records.length}件（${sinceISO}以降）`);

  const out = records.map((rec) => ({
    date: rec.report_date?.value ?? null,
    staff: rec.staff?.value ?? null,
    memo: rec.memo?.value ?? null,
    files: (rec.file_stock?.value ?? []).map((f) => f.name),
    rows: (rec.stock_rows?.value ?? []).map((row) => {
      const v = row.value ?? {};
      return {
        product: v.st_product?.value ?? null,
        sku: v.st_sku?.value ?? null,
        qty: Number(v.st_qty?.value) || 0,
        memo: v.st_memo?.value ?? null,
      };
    }),
  }));
  console.log('===STOCK_B===');
  console.log(encodeDigits(JSON.stringify(out)));
}

const isMain = process.argv[1] && process.argv[1].endsWith('stockReportDump.js');
if (isMain) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
