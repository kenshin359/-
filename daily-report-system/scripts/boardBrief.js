// ============================================================
//  経営ブリーフィング（AI経営チームの実行）
// ------------------------------------------------------------
//  Kintone の売上データを集計し、各部署のAIに渡して、
//  統括が1枚にまとめたものを通知します。
//
//  実行:
//    npm run brief                      … 昨日を対象に
//    npm run brief -- --date=2026-07-28
//    npm run brief -- --dry-run         … 送らずに内容だけ表示
//    npm run brief -- --show-departments … 各部署の生の出力も表示
//
//  ※ Kintone は読むだけ。一切変更しません。
//  ※ 数字の集計はすべてJS側で行い、AIには結果だけ渡します。
// ============================================================
import { fetchSalesApp, extractDailyRows } from '../lib/kintoneSalesDaily.js';
import { buildBriefings, runTeam, formatBoardBrief, DEPARTMENTS } from '../lib/aiTeam.js';
import { callClaudeRaw, parseJsonFromModel } from '../lib/claude.js';
import { notify, describeResults, resolveChannels } from '../lib/notify.js';
import { resolveTargetDate } from '../lib/date.js';
import { required } from '../lib/env.js';

const CH = ['rakuten', 'amazon', 'shopify', 'tiktok'];

/** 前日 */
function prevDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 販売個数の連続ゼロから欠品を疑う（在庫アプリができるまでの代替） */
function findStockoutSuspects(rows, upToISO, lookbackDays = 21) {
  const recent = rows.filter((r) => r.date <= upToISO).slice(-lookbackDays);
  const usable = recent.filter((r) => Object.keys(r.units).length > 0);
  if (usable.length < 5) return [];

  // 商品ごとの日次個数
  const byProduct = new Map();
  for (const r of usable) {
    for (const ch of CH) {
      for (const [name, qty] of Object.entries(r.units[ch] ?? {})) {
        if (!byProduct.has(name)) byProduct.set(name, new Map());
        const m = byProduct.get(name);
        m.set(r.date, (m.get(r.date) ?? 0) + qty);
      }
    }
  }

  const suspects = [];
  for (const [name, m] of byProduct) {
    const series = usable.map((r) => m.get(r.date) ?? 0);
    const sold = series.filter((v) => v > 0);
    if (sold.length < 5) continue;                       // 普段売れていない商品は対象外
    const avg = sold.reduce((a, b) => a + b, 0) / sold.length;
    if (avg < 3) continue;                                // 平均3個未満は判定しない

    // 末尾の連続ゼロ（＝いま止まっている）を重く見る
    let tail = 0;
    for (let i = series.length - 1; i >= 0 && series[i] === 0; i--) tail++;
    if (tail >= 2) {
      suspects.push({
        商品: name,
        連続ゼロ日数: tail,
        普段の1日あたり個数: Math.round(avg),
        推定機会損失個数: Math.round(avg * tail),
      });
    }
  }
  return suspects.sort((a, b) => b.推定機会損失個数 - a.推定機会損失個数).slice(0, 8);
}

async function main() {
  const today = resolveTargetDate();
  const target = process.argv.some((a) => a.startsWith('--date=')) ? today : prevDay(today);
  const isDry = process.argv.includes('--dry-run');
  const showDept = process.argv.includes('--show-departments');

  required('ANTHROPIC_API_KEY'); // 早めに落として、無駄なKintoneアクセスを避ける

  console.log(`${target} の経営ブリーフィングを作ります…`);

  const rows = extractDailyRows(await fetchSalesApp());
  const day = rows.find((r) => r.date === target);
  const prev = rows.find((r) => r.date === prevDay(target));

  if (!day) {
    console.log(`  ⚠️ ${target} の売上報告がまだ登録されていません。`);
    return;
  }

  // ── 数字はここで全部計算する（AIには渡すだけ）──
  const sales = {
    総売上: day.sales.total,
    楽天: day.sales.rakuten,
    Amazon: day.sales.amazon,
    自社サイト: day.sales.own,
    前日: prev ? prev.sales.total : null,
    前日比パーセント: prev && prev.sales.total
      ? Number((((day.sales.total - prev.sales.total) / prev.sales.total) * 100).toFixed(1))
      : null,
  };

  const marketing = {
    楽天アクセス数: day.metrics?.rakuten?.access ?? null,
    楽天転換率: day.metrics?.rakuten?.cvr ?? null,
    楽天お気に入り登録数: day.metrics?.rakuten?.fav ?? null,
    Amazonアクセス数: day.metrics?.amazon?.access ?? null,
    Amazon転換率: day.metrics?.amazon?.cvr ?? null,
    前日楽天アクセス数: prev?.metrics?.rakuten?.access ?? null,
    前日楽天転換率: prev?.metrics?.rakuten?.cvr ?? null,
  };

  // 商品別（個数の多い順に上位のみ）
  const productMap = new Map();
  for (const ch of CH) {
    for (const [name, qty] of Object.entries(day.units[ch] ?? {})) {
      const cur = productMap.get(name) ?? { 商品: name, 個数: 0 };
      cur.個数 += qty;
      productMap.set(name, cur);
    }
  }
  for (const [ch, key] of [['rakuten', '楽天転換率'], ['amazon', 'Amazon転換率']]) {
    for (const [name, v] of Object.entries(day.productCvr[ch] ?? {})) {
      const cur = productMap.get(name) ?? { 商品: name, 個数: 0 };
      cur[key] = v;
      productMap.set(name, cur);
    }
  }
  const products = [...productMap.values()].sort((a, b) => b.個数 - a.個数);

  const stockoutSuspects = findStockoutSuspects(rows, target);

  const briefings = buildBriefings({
    date: target,
    sales,
    marketing,
    products,
    stockoutSuspects,
    // 在庫アプリ・広告費アプリができたらここに入る
    inventory: null,
    adCosts: null,
    // 日報側は別系統（scripts/dailyDigest.js）で取得するため、ここでは渡さない
    reports: null,
    staffing: null,
  });

  const names = Object.keys(briefings)
    .map((k) => DEPARTMENTS.find((d) => d.key === k)?.name ?? k);
  console.log(`  稼働する部署: ${names.join(' / ') || '（データ不足でなし）'}`);
  if (stockoutSuspects.length) {
    console.log(`  欠品の疑い: ${stockoutSuspects.map((s) => `${s.商品}(${s.連続ゼロ日数}日)`).join(', ')}`);
  }

  if (!names.length) {
    console.log('  データが足りないため、実行しませんでした。');
    return;
  }

  // 各部署をAIで走らせる
  const callJson = async (system, payload) => {
    const raw = await callClaudeRaw({
      system,
      userText: '### 資料(JSON)\n```json\n' + JSON.stringify(payload, null, 2) + '\n```\n',
      maxTokens: 1200,
    });
    return parseJsonFromModel(raw);
  };

  const result = await runTeam(briefings, { callJson });

  if (showDept) {
    for (const [k, v] of Object.entries(result.departments)) {
      const d = DEPARTMENTS.find((x) => x.key === k);
      console.log(`\n── ${d?.name ?? k} ──`);
      console.log(JSON.stringify(v, null, 2));
    }
  }
  for (const e of result.errors) console.warn(`  ⚠️ ${e}`);

  const text = formatBoardBrief(result, { date: target });

  if (isDry) {
    console.log('\n--- [dry-run] 送信内容 ---\n' + text);
    return;
  }

  console.log(`\n通知先: ${resolveChannels().join(' + ') || '（未設定）'}`);
  const { results } = await notify(text);
  console.log(describeResults(results));
}

main().catch((e) => {
  console.error('ブリーフィング エラー:', e.message);
  process.exit(1);
});
