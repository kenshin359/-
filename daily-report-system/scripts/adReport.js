#!/usr/bin/env node
// ============================================================
//  広告費レポート（昨日 ＋ 今月）
// ------------------------------------------------------------
//  「広告費管理」アプリを読んで、
//    ・昨日の総広告費と、商品ごと・媒体ごとの内訳
//    ・今月の累計と、商品ごと・媒体ごとの内訳
//  を出します。Chatwork へ送ることもできます。
//
//  実行:
//    npm run ads:report                 … 画面に表示するだけ
//    npm run ads:report -- --send       … Chatwork にも送る
//    npm run ads:report -- --date=2026-07-29
//
//  ★計算はすべて JS で行います。AIは使いません（費用ゼロ・数字は正確）。
//  ★kintone は読むだけです。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optional, required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { summarize, formatAdSummary } from '../lib/adSummary.js';
import { productGroup } from '../lib/adClassify.js';
import { todayISO } from '../lib/date.js';
import { pushChatwork } from '../lib/chatwork.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** その年のRPP運用ルール（config/rpp-rules-YYYY.json）。無ければ null */
export function loadRppRules(dateISO) {
  const file = path.join(path.resolve(__dirname, '..'), 'config', `rpp-rules-${dateISO.slice(0, 4)}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** RPP運用ルール → 報告用の「RPP運用メモ」。ルールが無ければ null（従来どおり） */
export function formatRppMemo(rules) {
  if (!rules) return null;
  const lines = ['📌 RPP運用メモ（8月定例MTG）'];
  const floor = rules.policy?.roas_floor_pct;
  if (floor) lines.push(`・ROAS目標: ${floor.toLocaleString('ja-JP')}%以上を維持`);
  const reinforce = Array.isArray(rules.reinforce) ? rules.reinforce.filter((r) => !r.done) : [];
  if (reinforce.length) {
    const items = reinforce.map((r) => `${r.code}${r.理由 ? `（${r.理由}）` : ''}`).join(' / ');
    lines.push(`・強化: ${items}`);
  }
  const excl = Array.isArray(rules.exclusion_candidates) ? rules.exclusion_candidates.filter((r) => !r.done) : [];
  if (excl.length) {
    const items = excl
      .map((r) => `${r.code}（7月ROAS ${Number(r.roas_2026_07_pct).toLocaleString('ja-JP')}%）`)
      .join(' / ');
    lines.push(`・除外検討: ${items}`);
    const cond = excl.find((r) => r.条件)?.条件;
    if (cond) lines.push(`　※ ${cond}`);
  }
  return lines.length > 1 ? lines.join('\n') : null;
}

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

function auth() {
  const token = optional('KINTONE_API_TOKEN_ADCOST');
  if (token) return { 'X-Cybozu-API-Token': token };
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (!user || !pass) throw new Error('kintone の認証情報がありません（.env を確認してください）');
  return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
}

// ★GET に Content-Type を付けると kintone は 400 を返す
async function get(path) {
  const res = await fetchWithRetry(`${base()}${path}`, { method: 'GET', headers: auth() }, {
    label: `kintone GET ${path}`,
  });
  return res.json ?? {};
}

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** 前日の日付（YYYY-MM-DD） */
export function previousDay(dateISO) {
  const t = Date.parse(`${dateISO}T00:00:00Z`) - 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * レコード（1日1件・明細テーブル入り）を、1行 = 1明細 の形に開く。
 * 集計はすべてこの形に対して行います。
 */
export function flattenRecords(records) {
  const rows = [];
  for (const rec of records) {
    const date = rec.report_date?.value;
    if (!date) continue;
    for (const line of rec.detail?.value ?? []) {
      const v = line.value ?? {};
      const num = (f) => {
        const n = Number(v[f]?.value);
        return Number.isFinite(n) ? n : 0;
      };
      const product = v.d_product?.value || '未分類';
      rows.push({
        date,
        media: v.d_media?.value || 'その他',
        product,
        channel: v.d_channel?.value || '未分類',
        group: productGroup(product),
        campaign: v.d_campaign?.value || '',
        cost: num('d_cost'),
        impressions: num('d_impressions'),
        clicks: num('d_clicks'),
        conversions: num('d_conversions'),
        revenue: num('d_revenue'),
        // kintone に入っている時点で商品は人が確定させたものとみなす
        confidence: '確定',
      });
    }
  }
  return rows;
}

/** 全レコードを取る（500件ずつ・レコードIDで送る安全な方法） */
async function fetchAll(app) {
  const out = [];
  let lastId = 0;
  for (let i = 0; i < 200; i++) {
    const q = encodeURIComponent(`$id > ${lastId} order by $id asc limit 500`);
    const r = await get(`/k/v1/records.json?app=${app}&query=${q}`);
    const recs = r.records ?? [];
    out.push(...recs);
    if (recs.length < 500) break;
    lastId = Number(recs[recs.length - 1].$id.value);
  }
  return out;
}

async function main() {
  const app = optional('KINTONE_ADCOST_APP_ID');
  if (!app) {
    throw new Error(
      'KINTONE_ADCOST_APP_ID が未設定です。\n' +
        '  `npm run create-business-apps adcost` で作成し、表示された行を .env に貼ってください。'
    );
  }

  const today = arg('date') || todayISO();
  const yesterday = previousDay(today);
  const month = today.slice(0, 7);

  const rows = flattenRecords(await fetchAll(app));
  if (rows.length === 0) {
    console.log('広告費のデータがまだありません。');
    console.log('  kintone の「広告費管理」アプリに入力するか、');
    console.log('  npm run ads:import -- <CSVファイル> で取り込んでください。');
    return;
  }

  const dayRows = rows.filter((r) => r.date === yesterday);
  const monthRows = rows.filter((r) => r.date.startsWith(month));
  const prevMonthRows = rows.filter((r) => r.date.startsWith(previousMonth(month)));

  const parts = [];

  if (dayRows.length) {
    parts.push(
      formatAdSummary(summarize(dayRows), {
        title: `昨日の広告費（${yesterday}）`,
      })
    );
  } else {
    parts.push(`📣 昨日の広告費（${yesterday}）\n\nまだ入力がありません。`);
  }

  if (monthRows.length) {
    const days = new Set(monthRows.map((r) => r.date)).size;
    const sum = summarize(monthRows);
    parts.push(
      formatAdSummary(sum, {
        title: `今月の広告費（${month}）`,
        periodLabel: `${days}日ぶん入力済み ／ 1日平均 ${Math.round(sum.total.cost / days).toLocaleString('ja-JP')}円`,
        prevTotal: prevMonthRows.length
          ? prevMonthRows.reduce((s, r) => s + r.cost, 0)
          : null,
      })
    );
  }

  const rppMemo = formatRppMemo(loadRppRules(today));
  if (rppMemo) parts.push(rppMemo);

  const text = parts.join('\n\n────────────────────\n\n');
  console.log(text);

  if (process.argv.includes('--send')) {
    const roomId =
      optional('CHATWORK_ADS_ROOM_ID') ||
      optional('CHATWORK_SALES_ROOM_ID') ||
      optional('CHATWORK_ROOM_ID');
    if (!roomId) throw new Error('送信先のルームIDが未設定です（CHATWORK_ADS_ROOM_ID など）');
    const r = await pushChatwork(text, { roomId, title: `広告費レポート ${today}` });
    console.log(r.skipped ? '\n（APP_ENV=test のため送信していません）' : `\n✅ Chatwork（ルーム ${roomId}）に送信しました。`);
  }
}

/** 前の月（YYYY-MM） */
export function previousMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// テストから読み込んだときは実行しない
if (process.argv[1] && process.argv[1].endsWith('adReport.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
