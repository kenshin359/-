#!/usr/bin/env node
// ============================================================
//  売上・転換率報告アプリ（手入力）から直近のアクセス数・転換率を取り出す
// ------------------------------------------------------------
//  「アクセス大・転換率低」の分析用。読むだけ・書き込みなし。
//  出力の数字は 0-9 → A-J（Actionsのシークレットマスク対策）。
//
//  実行: node scripts/cvrDump.js --days=7
// ============================================================
import { fetchSalesApp, extractDailyRows } from '../lib/kintoneSalesDaily.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const encodeDigits = (s) => String(s).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);

async function main() {
  const days = Number(arg('days', '7'));
  const app = await fetchSalesApp();
  const rows = extractDailyRows(app);
  const since = new Date(Date.now() + 9 * 3600 * 1000);
  since.setUTCDate(since.getUTCDate() - days);
  const sinceISO = since.toISOString().slice(0, 10);

  const recent = rows.filter((r) => r.date >= sinceISO);
  console.log(`対象: ${recent.length}日分（${sinceISO}以降）`);

  const out = recent.map((r) => ({
    date: r.date,
    sales: r.sales,
    metrics: r.metrics,
    productCvr: r.productCvr,
  }));
  console.log('===CVR_B===');
  console.log(encodeDigits(JSON.stringify(out)));
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
