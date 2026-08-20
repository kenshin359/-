#!/usr/bin/env node
// ============================================================
//  広告CSVを「広告費管理」アプリに取り込む
// ------------------------------------------------------------
//  対応: Meta広告 / Amazon広告 / RPP(楽天) / Google広告 / TikTok広告
//
//  実行:
//    npm run ads:import -- data/ads/meta_0730.csv
//    npm run ads:import -- data/ads/*.csv --dry-run
//    npm run ads:import -- data/ads/rpp.csv --media="RPP(楽天)"
//    npm run ads:import -- data/ads/o2_google.csv --brand="O2"
//
//  ★--brand で ブランド（リベティ / O2 / ガジェティ）を付けられます。
//    省略時はアプリの既定値（リベティ）になります。
//
//  ★同じ日・同じ媒体を2回取り込んでも二重にはなりません。
//    その媒体の明細だけを入れ替えます（他の媒体はそのまま残ります）。
//
//  ★期間まとめのCSV（例: 7/1〜7/30が1行）は取り込みません。
//    1日ずつに割り振る方法が無く、勝手に等分すると
//    「昨日いくら使ったか」が嘘になるためです。
//    その場合は日別で書き出し直してください（やり方は下に出ます）。
// ============================================================
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { optional, required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { readAdFile } from '../lib/adCsv.js';
import { classifyRows, summarize, formatAdSummary } from '../lib/adSummary.js';
import { dedupKey } from '../kintone/adCostSchema.js';
import { yen } from '../lib/salesValues.js';

function appId() {
  return optional('KINTONE_ADCOST_APP_ID');
}

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

function auth() {
  const token = optional('KINTONE_API_TOKEN_ADCOST');
  if (token) return { 'X-Cybozu-Authorization-Token': token, 'X-Cybozu-API-Token': token };
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      '広告費アプリへの書き込みには KINTONE_API_TOKEN_ADCOST、\n' +
        'もしくは KINTONE_USER と KINTONE_PASSWORD が必要です。'
    );
  }
  return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
}

async function call(method, path, body) {
  const res = await fetchWithRetry(
    `${base()}${path}`,
    {
      method,
      // ★GET に Content-Type を付けると kintone は 400 を返す
      headers: method === 'GET' ? { ...auth() } : { 'Content-Type': 'application/json', ...auth() },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    },
    { label: `kintone ${method} ${path}` }
  );
  return res.json ?? {};
}

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** 明細1行を kintone のテーブル行の形にする */
function toDetailRow(r, brand) {
  const num = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '');
  return {
    value: {
      ...(brand ? { d_brand: { value: brand } } : {}),
      d_media: { value: r.media },
      d_product: { value: r.product },
      d_channel: { value: r.channel === '未分類' ? '未分類' : r.channel },
      d_campaign: { value: String(r.campaign ?? '').slice(0, 64) },
      d_cost: { value: num(r.cost) },
      d_impressions: { value: num(r.impressions) },
      d_clicks: { value: num(r.clicks) },
      d_conversions: { value: num(r.conversions) },
      d_revenue: { value: num(r.revenue) },
    },
  };
}

/** その日のレコードを探す */
async function findRecord(app, dateISO) {
  const q = encodeURIComponent(`dedup_key = "${dedupKey(dateISO)}" limit 1`);
  const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
  return r.records?.[0] ?? null;
}

/** 1日ぶんを登録・更新する（同じ媒体の明細だけ入れ替える） */
async function upsertDay(app, dateISO, media, rows, dryRun, brand) {
  const existing = await findRecord(app, dateISO);
  const newRows = rows.map((r) => toDetailRow(r, brand));

  // 既にある明細のうち、今回の媒体以外は残す
  const kept = (existing?.detail?.value ?? []).filter((row) => row.value?.d_media?.value !== media);
  const detail = [...kept, ...newRows];

  const record = {
    report_date: { value: dateISO },
    dedup_key: { value: dedupKey(dateISO) },
    source: { value: 'CSV取込' },
    detail: { value: detail },
  };

  const cost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const label = `${dateISO} ${media} ${rows.length}行 ${yen(cost)}`;

  if (dryRun) {
    console.log(`  [dry-run] ${existing ? '更新' : '新規'} ${label}（既存の他媒体 ${kept.length}行は保持）`);
    return;
  }

  if (existing) {
    await call('PUT', '/k/v1/record.json', { app, id: existing.$id.value, record });
    console.log(`  更新 ${label}`);
  } else {
    await call('POST', '/k/v1/record.json', { app, record });
    console.log(`  新規 ${label}`);
  }
}

function explainPeriodFile(file, parsed) {
  console.log('');
  console.log(`⚠ ${basename(file)} は「期間まとめ」のファイルです（${parsed.periodStart} 〜 ${parsed.periodEnd}）。`);
  console.log('  1行が期間の合計なので、どの日にいくら使ったか分かりません。');
  console.log('  勝手に日数で割ると「昨日の広告費」が嘘になるため、取り込みません。');
  console.log('');
  console.log('  日別で書き出す手順（Meta広告の場合）:');
  console.log('    広告マネージャ →「レポート」→ 内訳 →「時間」→「日別」を選ぶ');
  console.log('    → 書き出し（CSV）→ そのファイルを取り込んでください');
  console.log('  Amazon広告 / Google広告 / TikTok広告 も、レポート作成時に');
  console.log('  「日別（Daily）」を選べば同じ形になります。');
  console.log('');
  console.log('  ※ どうしても1日にまとめて入れたいときは --force-date=YYYY-MM-DD を付けてください。');
}

async function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const mediaOverride = arg('media');
  const brandOverride = arg('brand');
  const forceDate = arg('force-date');

  if (files.length === 0) {
    console.log('使い方: npm run ads:import -- <CSVファイル…> [--dry-run] [--media="RPP(楽天)"] [--brand="リベティ"]');
    process.exit(1);
  }

  const app = appId();
  if (!app && !dryRun) {
    throw new Error(
      'KINTONE_ADCOST_APP_ID が未設定です。\n' +
        '  先に `npm run create-business-apps adcost` でアプリを作り、\n' +
        '  表示された行を .env に貼り付けてください。'
    );
  }

  let all = [];
  let blocked = 0;

  for (const file of files) {
    const parsed = readAdFile(readFileSync(file), { filename: file, media: mediaOverride });
    const rows = classifyRows(parsed.rows).filter((r) => (r.cost ?? 0) > 0);

    console.log(`\n▶ ${basename(file)}`);
    console.log(`  媒体: ${parsed.media} ／ 期間: ${parsed.periodStart} 〜 ${parsed.periodEnd} ／ ${rows.length}件`);
    if (parsed.skipped.length) console.log(`  読み飛ばし: ${parsed.skipped.length}行（金額が空の行）`);

    all = all.concat(rows);

    // 日ごとにまとめて登録する
    const byDate = new Map();
    for (const r of rows) {
      const d = forceDate || (parsed.isDaily ? r.dateStart : null);
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(r);
    }

    if (byDate.size === 0) {
      explainPeriodFile(file, parsed);
      blocked++;
      continue;
    }

    for (const [date, dayRows] of [...byDate.entries()].sort()) {
      await upsertDay(app, date, parsed.media, dayRows, dryRun, brandOverride);
    }
  }

  if (all.length) {
    console.log('');
    console.log('════════ 取り込んだ内容の集計 ════════');
    console.log(formatAdSummary(summarize(all), { title: '広告費の内訳' }));
  }

  if (blocked) {
    console.log('');
    console.log(`※ ${blocked}ファイルは期間まとめのため取り込みませんでした（上の集計には含めています）。`);
  }
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
