// ============================================================
//  月次売上レポート（Kintone 売上・転換率報告アプリ ID 7 から作成）
// ------------------------------------------------------------
//  総売上 / 昨日の売上 / 前日比 / 前月比 / イベントの有無 を
//  1通にまとめて Chatwork（LINE）へ送ります。
//
//  実行:
//    npm run monthly                   … 今日を基準に作成
//    npm run monthly -- --date=2026-07-29
//    npm run monthly -- --dry-run      … 送らずに内容だけ表示
//
//  ※ Kintone は読むだけ。一切変更しません。
//  ※ 集計はすべてJS側で行うため、通常は Claude API を呼びません（費用ゼロ）。
//     SALES_AI_COMMENT=true のときだけ、集計済みの数字を渡して一言もらいます。
// ============================================================
import { fetchSalesRecords, extractDailySales, findDateIssues, salesAppId } from '../lib/kintoneSales.js';
import { buildMonthlySalesReport, formatMonthlySalesReport } from '../lib/monthlySalesReport.js';
import { notify, describeResults, resolveChannels } from '../lib/notify.js';
import { resolveTargetDate } from '../lib/date.js';
import { optional } from '../lib/env.js';

async function main() {
  const todayISO = resolveTargetDate();
  const isDry = process.argv.includes('--dry-run');

  console.log(`売上アプリ(ID ${salesAppId()})から ${todayISO} 基準のレポートを作ります…`);

  const records = await fetchSalesRecords();
  console.log(`  レコード: ${records.length}件（1レコード＝1ヶ月）`);

  const rows = extractDailySales(records);
  console.log(`  日次データ: ${rows.length}件`);

  const issues = findDateIssues(rows);
  for (const i of issues) console.log(`  ⚠️ ${i.detail}`);

  const rep = buildMonthlySalesReport(rows, todayISO);
  console.log(
    `  ${rep.month}: ${rep.dayCount}日分 / 累計 ¥${rep.totals.total.toLocaleString('ja-JP')}`
  );

  // AIコメントは既定OFF（費用ゼロで運用できるように）
  let comment = null;
  if (optional('SALES_AI_COMMENT', 'false') === 'true' && optional('ANTHROPIC_API_KEY')) {
    try {
      const { commentOnSales } = await import('../lib/claude.js');
      const r = await commentOnSales({
        date: rep.today,
        prevDate: rep.yesterdayISO,
        totals: {
          revenue: rep.totals.total,
          prevRevenue: rep.dayBefore?.total ?? null,
          orders: 0,
          aov: null,
          adCost: 0,
          roas: null,
          adRatio: null,
        },
        salesChannels: [
          { id: 'rakuten', label: '楽天', revenue: rep.totals.rakuten, prevRevenue: null, hasData: true },
          { id: 'amazon', label: 'Amazon', revenue: rep.totals.amazon, prevRevenue: null, hasData: true },
          { id: 'own', label: '自社サイト', revenue: rep.totals.own, prevRevenue: null, hasData: true },
        ],
        adChannels: [],
        topProducts: [],
      });
      comment = r?.comment ?? null;
      console.log(`  💡 AIコメント: ${comment}`);
    } catch (e) {
      console.warn(`  ⚠️ AIコメントの生成に失敗（本文のみ送信します）: ${e.message}`);
    }
  }

  const text = formatMonthlySalesReport(rep, { issues, comment });

  if (isDry) {
    console.log('\n--- [dry-run] 送信内容 ---\n' + text);
    return;
  }

  const channels = resolveChannels();
  console.log(`\n通知先: ${channels.join(' + ') || '（未設定）'}`);
  const { results } = await notify(text);
  console.log(describeResults(results));
}

main().catch((e) => {
  console.error('月次売上レポート エラー:', e.message);
  process.exit(1);
});
