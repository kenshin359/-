// O2GYM 広告売上KPI 自動連携 メイン処理
// 対象日（既定=昨日 JST）について、各媒体から数字を集め、KPIアプリへ upsert する。
//
// 使い方:
//   node src/main.js            … 昨日分を取り込み
//   node src/main.js 2026-08-01 … 指定日を取り込み
//   DRY_RUN=1 node src/main.js  … kintone へ書き込まず結果だけ表示
//
// 設計方針:
//   ・各媒体はトークン未設定なら自動スキップ（段階導入OK）
//   ・1媒体が失敗しても他は続行（原因を警告表示）
//   ・アクセス数/成約数(入会) は店舗運用に依存するため、ここでは触らず手入力を尊重
import { getDailySales } from './sources/shopify.js';
import { getDailySpend } from './sources/meta.js';
import { getDailyCost } from './sources/googleAds.js';
import { getDailyFromCsv } from './sources/storesCsv.js';
import { upsertDaily } from './pushKpi.js';

function yesterdayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000); // UTC→JST
  jst.setUTCDate(jst.getUTCDate() - 1);
  return jst.toISOString().slice(0, 10);
}

async function runSource(name, fn) {
  try {
    const out = await fn();
    if (out === null) {
      console.log(`- ${name}: スキップ（未設定）`);
      return {};
    }
    console.log(`- ${name}: OK`, out);
    return out;
  } catch (e) {
    console.warn(`- ${name}: ⚠ 失敗 → ${e.message}`);
    return {};
  }
}

async function main() {
  const date = process.argv[2] || yesterdayJST();
  console.log(`\n=== O2GYM KPI 自動連携 | 対象日 ${date} ===`);

  const results = await Promise.all([
    runSource('Shopify 売上', () => getDailySales(date)),
    runSource('STORES 売上(CSV)', () => getDailyFromCsv(date)),
    runSource('Meta 広告費', () => getDailySpend(date)),
    runSource('Google 広告費', () => getDailyCost(date)),
  ]);

  // 集約（内部用の _ 始まりキーは kintone へ送らない）
  const merged = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(r)) {
      if (k.startsWith('_')) continue;
      merged[k] = v;
    }
  }

  if (Object.keys(merged).length === 0) {
    console.log('\n取り込める数字がありませんでした（全媒体スキップ/失敗）。Secrets を確認してください。');
    return;
  }

  console.log('\nKPIアプリへ書き込む内容:', { date, ...merged });

  if (process.env.DRY_RUN) {
    console.log('DRY_RUN のため書き込みはスキップしました。');
    return;
  }

  const action = await upsertDaily(date, merged);
  console.log(`kintone: レコードを${action === 'created' ? '新規作成' : '更新'}しました。`);
}

main().catch((e) => {
  console.error('致命的エラー:', e.message);
  process.exit(1);
});
