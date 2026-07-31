#!/usr/bin/env node
// ============================================================
//  提出ボックスのCSVを読み取って取り込む
// ------------------------------------------------------------
//  「日次CSV提出ボックス」に置かれたファイルを読み、
//    ・広告CSV → 「広告費管理」アプリへ取り込む
//    ・売上CSV → 集計して報告する（アプリへの書き込みはしません）
//  最後に、何をどう読んだかを提出ボックスの「取込ログ」に書き戻します。
//
//  実行:
//    npm run intake:import                 … 今日ぶん
//    npm run intake:import -- --date=2026-07-31
//    npm run intake:import -- --dry-run    … 書き込まず内容だけ表示
//    npm run intake:import -- --send       … 結果を Chatwork にも送る
//
//  ★売上・転換率報告アプリ（人が手で書いているもの）と
//    日報アプリには一切書き込みません。
//  ★期間まとめの広告CSVは取り込みません（日別に割り振れないため）。
// ============================================================
import { checkDay, downloadFile, writeBack, intakeAppId, call } from '../lib/intake.js';
import { SALES_SLOTS, AD_SLOTS } from '../kintone/intakeSchema.js';
import { readAdFile } from '../lib/adCsv.js';
import { classifyRows, summarize, formatAdSummary } from '../lib/adSummary.js';
import { dedupKey as adDedupKey } from '../kintone/adCostSchema.js';
import { aggregateFile } from '../lib/salesAggregate.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { yen } from '../lib/salesValues.js';
import { todayISO } from '../lib/date.js';
import { pushChatwork } from '../lib/chatwork.js';
import { optional } from '../lib/env.js';

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const isDry = process.argv.includes('--dry-run');

const HERE = dirname(fileURLToPath(import.meta.url));
const mapping = JSON.parse(
  readFileSync(
    optional('SALES_MAPPING_PATH') || join(HERE, '..', 'config', 'sales-mapping.json'),
    'utf8'
  )
);

/** 広告費管理アプリへ、その日・その媒体ぶんを入れ替えで書く */
async function upsertAdDay(adApp, dateISO, media, rows) {
  const q = encodeURIComponent(`dedup_key = "${adDedupKey(dateISO)}" limit 1`);
  const found = await call('GET', `/k/v1/records.json?app=${adApp}&query=${q}`);
  const existing = found.records?.[0] ?? null;

  const num = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '');
  const newRows = rows.map((r) => ({
    value: {
      d_media: { value: r.media },
      d_product: { value: r.product },
      d_channel: { value: r.channel },
      d_campaign: { value: String(r.campaign ?? '').slice(0, 64) },
      d_cost: { value: num(r.cost) },
      d_impressions: { value: num(r.impressions) },
      d_clicks: { value: num(r.clicks) },
      d_conversions: { value: num(r.conversions) },
      d_revenue: { value: num(r.revenue) },
    },
  }));

  // 同じ媒体の明細だけ入れ替える（他の媒体は残す）
  const kept = (existing?.detail?.value ?? []).filter((row) => row.value?.d_media?.value !== media);
  const record = {
    report_date: { value: dateISO },
    dedup_key: { value: adDedupKey(dateISO) },
    source: { value: 'CSV取込' },
    detail: { value: [...kept, ...newRows] },
  };

  if (isDry) return { action: existing ? '更新(予定)' : '新規(予定)', kept: kept.length };
  if (existing) {
    await call('PUT', '/k/v1/record.json', { app: adApp, id: existing.$id.value, record });
    return { action: '更新', kept: kept.length };
  }
  await call('POST', '/k/v1/record.json', { app: adApp, record });
  return { action: '新規', kept: kept.length };
}

async function main() {
  const app = intakeAppId();
  const adApp = optional('KINTONE_ADCOST_APP_ID');
  const date = arg('date') || todayISO();

  const check = await checkDay(date, app);
  if (!check.exists) {
    console.log(`${date} のレコードがありません。まず提出ボックスにファイルを置いてください。`);
    return;
  }

  const log = [];
  const report = [];
  const allAdRows = [];

  log.push(`取込日時: ${new Date().toLocaleString('ja-JP')}`);
  log.push(`対象日: ${date}`);
  log.push('');

  // ── 広告CSV ──
  for (const slot of AD_SLOTS) {
    const s = check.slots.find((x) => x.code === slot.code);
    if (!s?.filled) { log.push(`${slot.label}: ファイルなし`); continue; }

    for (const f of s.files) {
      try {
        const buf = await downloadFile(f.fileKey);
        const parsed = readAdFile(buf, { filename: f.name, media: slot.media });
        const rows = classifyRows(parsed.rows).filter((r) => (r.cost ?? 0) > 0);
        allAdRows.push(...rows);

        if (!parsed.isDaily) {
          // ★期間まとめは日別に割り振れない。等分すると「昨日の広告費」が嘘になる。
          log.push(
            `${slot.label}: ${f.name} … 期間まとめ（${parsed.periodStart}〜${parsed.periodEnd}）のため取り込みませんでした`
          );
          report.push(`⚠ ${slot.label} は期間まとめのCSVでした。日別で書き出し直してください。`);
          continue;
        }
        if (!adApp) {
          log.push(`${slot.label}: ${f.name} … KINTONE_ADCOST_APP_ID 未設定のため取り込みなし`);
          continue;
        }

        const day = rows[0]?.dateStart ?? parsed.periodStart;
        const r = await upsertAdDay(adApp, day, slot.media, rows);
        const cost = rows.reduce((a, b) => a + (b.cost ?? 0), 0);
        log.push(`${slot.label}: ${f.name} … ${rows.length}件 ${yen(cost)} を${r.action}`);
        report.push(`✅ ${slot.label} ${rows.length}件 ${yen(cost)}`);
      } catch (e) {
        log.push(`${slot.label}: ${f.name} … 読み取り失敗（${e.message}）`);
        report.push(`❌ ${slot.label} の読み取りに失敗しました`);
      }
    }
  }

  // ── 売上CSV ──
  // ★売上は kintone に書き込みません。人が手で入力しているアプリがあり、
  //   自動で書き足すと、どちらが正しいか分からなくなるためです。
  log.push('');
  for (const slot of SALES_SLOTS) {
    const s = check.slots.find((x) => x.code === slot.code);
    if (!s?.filled) { log.push(`${slot.label}: ファイルなし`); continue; }

    for (const f of s.files) {
      try {
        const buf = await downloadFile(f.fileKey);
        // 置き場で媒体が決まっているので、ファイル名には頼りません
        const agg = aggregateFile({ name: f.name, buffer: buf, channelId: slot.channelId }, mapping);
        if (!agg.ok) {
          log.push(`${slot.label}: ${f.name} … 読めませんでした（${agg.reason}）`);
          report.push(`⚠ ${slot.label} を読めませんでした: ${agg.reason}`);
          continue;
        }
        // aggregateFile は日付ごとの箱（daily）で返すので、ここで合計します
        const days = Object.entries(agg.daily ?? {});
        const revenue = days.reduce((a, [, v]) => a + (v.revenue ?? 0), 0);
        const units = days.reduce((a, [, v]) => a + (v.units ?? 0), 0);
        const span = days.length ? `${days.map(([d]) => d).sort()[0]}〜${days.map(([d]) => d).sort().at(-1)}` : '—';
        log.push(
          `${slot.label}: ${f.name}（${agg.encoding}）… ${agg.rowCount}行 / ${span} / 売上 ${yen(revenue)}` +
            (units ? ` / ${units}点` : '')
        );
        report.push(`📄 ${slot.label} 売上 ${yen(revenue)}${units ? `（${units}点）` : ''}`);
      } catch (e) {
        log.push(`${slot.label}: ${f.name} … 読み取り失敗（${e.message}）`);
        report.push(`❌ ${slot.label} の読み取りに失敗しました`);
      }
    }
  }

  const logText = log.join('\n');
  console.log(logText);

  // 広告の集計を表示
  if (allAdRows.length) {
    console.log('\n' + formatAdSummary(summarize(allAdRows), { title: `広告費の内訳（${date}）` }));
  }

  if (!isDry) {
    const done = check.missing.length === 0;
    await writeBack(check.recordId, { log: logText, status: done ? '取込済み' : undefined }, app);
    console.log('\n取込ログを提出ボックスに書き戻しました。');
  }

  if (process.argv.includes('--send')) {
    const roomId =
      optional('CHATWORK_INTAKE_ROOM_ID') ||
      optional('CHATWORK_SALES_ROOM_ID') ||
      optional('CHATWORK_ROOM_ID');
    if (!roomId) throw new Error('送信先のルームIDが未設定です');
    const text = [`📦 CSV取り込み結果（${date}）`, '', ...report].join('\n');
    const r = await pushChatwork(text, { roomId, title: `CSV取り込み ${date}` });
    console.log(r.skipped ? '（APP_ENV=test のため送信していません）' : `✅ 送信しました（ルーム ${roomId}）`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('intakeImport.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
