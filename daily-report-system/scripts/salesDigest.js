// ============================================================
//  売上レポート（Amazon / 楽天 / 自社 / Meta広告 / RPP広告）
// ------------------------------------------------------------
//  フォルダに置かれたCSVを読んで集計し、1通にまとめて通知します。
//
//  【使い方】
//    1. data/sales/ フォルダに、各管理画面から落としたCSVを入れる
//       ※ ファイル名に媒体名を入れてください
//          例) amazon_2026-07.csv / 楽天_受注.csv / meta_ads.csv / rpp.csv
//    2. npm run sales
//
//  【オプション】
//    npm run sales -- --dry-run          送らずに内容だけ表示
//    npm run sales -- --date=2026-07-28  対象日を指定
//    npm run sales -- --dir=/path/to/csv 読み込むフォルダを変える
//
//  【費用について】
//    集計はすべてこのプログラムが行うので、通常は費用ゼロです。
//    .env に SALES_AI_COMMENT=true を書いた場合だけ、
//    末尾に AI の気づきが1行入ります（1回あたり数円）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregateFile, buildDailySummary } from '../lib/salesAggregate.js';
import { formatSalesSummary } from '../lib/salesFormat.js';
import { notify, describeResults, resolveChannels } from '../lib/notify.js';
import { resolveTargetDate } from '../lib/date.js';
import { optional } from '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const READABLE = /\.(csv|tsv|txt)$/i;

/** 引数 --xxx=値 を取り出す */
function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** 前日の日付を返す */
function previousDay(dateISO) {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function loadMapping() {
  const custom = optional('SALES_MAPPING_PATH');
  const file = custom ? path.resolve(custom) : path.join(ROOT, 'config', 'sales-mapping.json');
  if (!fs.existsSync(file)) throw new Error(`列の設定ファイルが見つかりません: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadFiles(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(
      `フォルダがありません: ${dir}\n` +
        `  作成してCSVを入れてください（例: mkdir -p ${path.relative(ROOT, dir) || dir}）`
    );
  }
  return fs
    .readdirSync(dir)
    .filter((f) => READABLE.test(f) && !f.startsWith('.'))
    .map((f) => ({ name: f, buffer: fs.readFileSync(path.join(dir, f)) }));
}

async function main() {
  const dateISO = resolveTargetDate();
  const prevISO = previousDay(dateISO);
  const isDry = process.argv.includes('--dry-run');

  const dir = arg('dir')
    ? path.resolve(arg('dir'))
    : path.resolve(optional('SALES_DATA_DIR') || path.join(ROOT, 'data', 'sales'));

  console.log(`${dateISO} の売上レポートを作成します…`);
  console.log(`  データ元: ${dir}`);

  const files = loadFiles(dir);
  if (files.length === 0) {
    console.log('  ⚠️ 読み込めるCSVがありません。処理を終了します。');
    return;
  }
  console.log(`  ファイル: ${files.length}件`);

  const mapping = loadMapping();
  const results = files.map((f) => aggregateFile(f, mapping));

  for (const r of results) {
    if (r.ok) {
      console.log(`  ✅ ${r.fileName} → ${r.label}（${r.rowCount}行 / ${r.encoding}）`);
      if (r.skipped) console.log(`     ※ 日付を読めず除外: ${r.skipped}行`);
    } else {
      console.log(`  ⚠️ ${r.fileName}: ${r.reason}`);
    }
  }

  const summary = buildDailySummary(results, dateISO, prevISO);

  // AIコメントは既定OFF（費用ゼロで運用できるように）
  let comment = null;
  if (optional('SALES_AI_COMMENT', 'false') === 'true' && optional('ANTHROPIC_API_KEY')) {
    try {
      const { commentOnSales } = await import('../lib/claude.js');
      const r = await commentOnSales(summary);
      comment = r?.comment ?? null;
      console.log(`  💡 AIコメント: ${comment}`);
    } catch (e) {
      // コメントが無くてもレポート自体は届けたい
      console.warn(`  ⚠️ AIコメントの生成に失敗（本文のみ送信します）: ${e.message}`);
    }
  }

  const text = formatSalesSummary(summary, { comment });

  if (isDry) {
    console.log('\n--- [dry-run] 送信内容 ---\n' + text);
    return;
  }

  const channels = resolveChannels();
  console.log(`\n通知先: ${channels.join(' + ') || '（未設定）'}`);
  const { results: sent } = await notify(text);
  console.log(describeResults(sent));
}

main().catch((e) => {
  console.error('売上レポート エラー:', e.message);
  process.exit(1);
});
