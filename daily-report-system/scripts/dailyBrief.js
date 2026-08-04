#!/usr/bin/env node
// ============================================================
//  参謀レポート（毎朝の全チャネルまとめ）
// ------------------------------------------------------------
//  Amazon・楽天・自社サイトの取込が終わった後（毎朝8:45）に、
//  売上明細アプリを読み直して1通にまとめ、Chatworkへ送ります。
//
//  入るもの:
//    総売上 / 月間目標の達成率 / 媒体別 / 商品別 /
//    直近15日平均との差 / 前月同期間比 / その日のメモ（イベント欄）
//
//  月間目標は Secrets の SALES_TARGET_MONTHLY（円）で設定します。
//  ★キントーンは読むだけ。書き込みは一切しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';
import { salesAppId } from '../lib/salesDetailWrite.js';
import { yen } from '../lib/salesValues.js';
import { pushChatwork } from '../lib/chatwork.js';
import { resolveRange } from './shopifyImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** その月の日別計画（config/daily-plan-YYYY-MM.json）。無ければ null */
export function loadDailyPlan(dateISO) {
  const file = path.join(path.resolve(__dirname, '..'), 'config', `daily-plan-${dateISO.slice(0, 7)}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 期間内の日次レコードを全部読む（1日1レコード） */
async function fetchDays(app, fromISO, toISO) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const q = encodeURIComponent(
      `report_date >= "${fromISO}" and report_date <= "${toISO}" order by report_date asc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    out.push(...(r.records ?? []));
    if ((r.records ?? []).length < 100) break;
  }
  return out;
}

function dayTotal(rec) {
  return (rec?.detail?.value ?? []).reduce((s, row) => s + Number(row.value?.s_amount?.value ?? 0), 0);
}

/** 日別計画との比較（当日と月累計）。plan が無ければ null */
export function computePlanCompare(records, dateISO, plan) {
  if (!plan?.days) return null;
  const dayPlan = plan.days[dateISO];
  const dayPlanTotal = dayPlan ? Object.values(dayPlan).reduce((s, v) => s + v, 0) : null;
  const monthStart = `${dateISO.slice(0, 7)}-01`;
  let mtdPlan = 0;
  for (const [d, chs] of Object.entries(plan.days)) {
    if (d >= monthStart && d <= dateISO) mtdPlan += Object.values(chs).reduce((s, v) => s + v, 0);
  }
  const byDate = new Map(records.map((r) => [r.report_date?.value, r]));
  const today = byDate.get(dateISO);
  const dayActual = (today?.detail?.value ?? []).reduce((s, row) => s + Number(row.value?.s_amount?.value ?? 0), 0);
  let mtdActual = 0;
  for (const r of records) {
    const d = r.report_date?.value;
    if (d && d >= monthStart && d <= dateISO) {
      mtdActual += (r.detail?.value ?? []).reduce((s, row) => s + Number(row.value?.s_amount?.value ?? 0), 0);
    }
  }
  return {
    dayPlan: dayPlanTotal,
    dayDiff: dayPlanTotal === null ? null : dayActual - dayPlanTotal,
    mtdPlan,
    mtdDiff: mtdActual - mtdPlan,
    mtdRate: mtdPlan ? (mtdActual / mtdPlan) * 100 : null,
    channels: dayPlan ?? null,
  };
}

/** レコード群 → レポートの材料（計算は全部ここ。テストしやすい純関数） */
export function computeBrief(records, dateISO, monthlyTarget) {
  const byDate = new Map(records.map((r) => [r.report_date?.value, r]));
  const today = byDate.get(dateISO);

  const channels = new Map();
  const products = new Map();
  for (const row of today?.detail?.value ?? []) {
    const v = row.value ?? {};
    const amt = Number(v.s_amount?.value ?? 0);
    const qty = Number(v.s_qty?.value ?? 0);
    const ch = v.s_channel?.value ?? '不明';
    const pr = v.s_product?.value ?? '不明';
    channels.set(ch, (channels.get(ch) ?? 0) + amt);
    if (!products.has(pr)) products.set(pr, { amount: 0, qty: 0 });
    products.get(pr).amount += amt;
    products.get(pr).qty += qty;
  }
  const total = [...channels.values()].reduce((s, v) => s + v, 0);

  // 直近15日平均（前日までの15日間・データがある日だけで平均）
  const prev15 = [];
  for (let i = 1; i <= 15; i++) {
    const rec = byDate.get(addDays(dateISO, -i));
    if (rec) prev15.push(dayTotal(rec));
  }
  const avg15 = prev15.length ? prev15.reduce((s, v) => s + v, 0) / prev15.length : null;
  const vsAvg = avg15 ? ((total - avg15) / avg15) * 100 : null;

  // 月累計と、前月の同じ期間（1日〜同じ日数）の累計
  const monthStart = `${dateISO.slice(0, 7)}-01`;
  const dayN = Number(dateISO.slice(8, 10));
  const prevMonthStart = addDays(monthStart, -1).slice(0, 7) + '-01';
  let mtd = 0;
  let prevMtd = 0;
  for (const r of records) {
    const d = r.report_date?.value;
    if (!d) continue;
    if (d >= monthStart && d <= dateISO) mtd += dayTotal(r);
    if (d >= prevMonthStart && d < monthStart && Number(d.slice(8, 10)) <= dayN) prevMtd += dayTotal(r);
  }
  const vsPrevMonth = prevMtd ? (mtd / prevMtd - 1) * 100 : null;
  const achievement = monthlyTarget ? (mtd / monthlyTarget) * 100 : null;

  const note = String(today?.note?.value ?? '').trim();

  return { total, channels, products, avg15, vsAvg, mtd, prevMtd, vsPrevMonth, achievement, note, hasData: !!today };
}

const pct = (v) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

export function formatBrief(b, dateISO, monthlyTarget, planCmp = null) {
  const lines = [
    `[info][title]🧭 参謀レポート ${dateISO}（全チャネル）[/title]`,
    `■ 総売上  ${yen(b.total)}`,
  ];
  if (planCmp && planCmp.dayPlan !== null) {
    const sign = planCmp.dayDiff >= 0 ? '+' : '';
    lines.push(`■ 日別計画 ${yen(planCmp.dayPlan)} ／ 差額 ${sign}${yen(planCmp.dayDiff)} ${planCmp.dayDiff >= 0 ? '✅' : '⚠️'}`);
  }
  if (monthlyTarget) {
    lines.push(`■ 月間目標 ${yen(monthlyTarget)} ／ 月累計 ${yen(b.mtd)} ／ 達成率 ${b.achievement.toFixed(1)}%`);
  } else {
    lines.push(`■ 月累計 ${yen(b.mtd)}（月間目標は SALES_TARGET_MONTHLY で設定できます）`);
  }
  if (planCmp && planCmp.mtdRate !== null) {
    const sign = planCmp.mtdDiff >= 0 ? '+' : '';
    lines.push(`■ 累計計画比 ${planCmp.mtdRate.toFixed(1)}%（計画 ${yen(planCmp.mtdPlan)} ／ 差額 ${sign}${yen(planCmp.mtdDiff)}）`);
  }
  lines.push(`■ 直近15日平均との差 ${pct(b.vsAvg)}`);
  lines.push(`■ 前月同期間比 ${pct(b.vsPrevMonth)}（前月同期間 ${yen(b.prevMtd)}）`);
  lines.push('');
  lines.push('【媒体別】');
  for (const [ch, amt] of [...b.channels.entries()].sort((a, x) => x[1] - a[1])) {
    lines.push(`・${ch}  ${yen(amt)}`);
  }
  lines.push('');
  lines.push('【商品別】');
  const prods = [...b.products.entries()].sort((a, x) => x[1].amount - a[1].amount);
  for (const [pr, v] of prods.slice(0, 12)) {
    lines.push(`・${pr} ×${v.qty}  ${yen(v.amount)}`);
  }
  if (prods.length > 12) lines.push(`（ほか ${prods.length - 12}商品）`);
  lines.push('');
  lines.push(`■ イベント・メモ  ${b.note || 'なし'}`);
  lines.push('※ 詳細はキントーン「売上明細（自動取込）」へ。日次CSVも添付されています。');
  lines.push('[/info]');
  return lines.join('\n');
}

async function main() {
  const { from } = resolveRange();
  const dateISO = from;
  const app = salesAppId();
  const planForTarget = loadDailyPlan(dateISO);
  // 月間目標: Secrets 優先、無ければ日別計画ファイルの monthly_target
  const target = Number(optional('SALES_TARGET_MONTHLY', '')) || planForTarget?.monthly_target || null;

  // 15日平均＋前月比のため、前月初日から読む
  const monthStart = `${dateISO.slice(0, 7)}-01`;
  const readFrom = addDays(monthStart, -1).slice(0, 7) + '-01';
  const records = await fetchDays(app, readFrom, dateISO);

  const brief = computeBrief(records, dateISO, target);
  if (!brief.hasData) {
    console.log(`${dateISO} のレコードがまだありません。取込のあとに実行してください。`);
    return;
  }

  const planCmp = computePlanCompare(records, dateISO, planForTarget);
  const body = formatBrief(brief, dateISO, target, planCmp);
  console.log(body);

  const roomId = optional('CHATWORK_SALES_ROOM_ID') || optional('CHATWORK_ROOM_ID');
  if (roomId && optional('CHATWORK_API_TOKEN')) {
    await pushChatwork(body, { roomId });
    console.log(`\nChatwork（ルーム ${roomId}）に送りました`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('dailyBrief.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
