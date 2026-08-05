#!/usr/bin/env node
// ============================================================
//  売上の検算（自動照合・自動修正）
// ------------------------------------------------------------
//  「キントーンの数字」と「販売元APIの今の数字」を突き合わせて、
//  ずれていたらその日だけ取込をやり直し、Chatworkに差分を報告します。
//
//  なぜ必要か:
//    ・楽天の受注APIは注文の反映に数時間遅れることがある
//    ・キャンセル・注文修正は取込のあとに起きる
//    → 一度取り込んだ日でも、あとから数字が動くため。
//
//  対象: 楽天・自社サイト（Amazonは連携審査が通り次第追加）
//  範囲: 昨日から3日前まで（--days で変更可）
//
//  実行:
//    node scripts/salesRecheck.js            … 照合してずれたら自動修正
//    node scripts/salesRecheck.js --dry-run  … 照合だけ（直さない）
// ============================================================
import { execFileSync } from 'node:child_process';
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';
import { pushChatwork } from '../lib/chatwork.js';
import { yen } from '../lib/salesValues.js';
import { fetchOrders as fetchRakuten, ordersToRows as rakutenRows } from '../lib/rakutenPay.js';
import { fetchOrders as fetchShopify, ordersToRows as shopifyRows } from '../lib/shopify.js';
import { todayISO } from '../lib/date.js';

const isDry = process.argv.includes('--dry-run');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** 日本時間で n 日前の日付 */
export function daysAgoISO(n, today = todayISO()) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** キントーン売上明細から日別×販売先の合計を読む */
async function kintoneDayTotals(app, from, to) {
  const totals = {};
  let offset = 0;
  for (;;) {
    const q = encodeURIComponent(
      `report_date >= "${from}" and report_date <= "${to}" order by report_date asc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    for (const rec of r.records ?? []) {
      const d = rec.report_date?.value;
      if (!d) continue;
      for (const row of rec.detail?.value ?? []) {
        const v = row.value ?? {};
        const ch = v.s_channel?.value ?? '不明';
        const amt = Number(v.s_amount?.value) || 0;
        totals[d] = totals[d] ?? {};
        totals[d][ch] = (totals[d][ch] ?? 0) + amt;
      }
    }
    if ((r.records ?? []).length < 100) break;
    offset += 100;
  }
  return totals;
}

/**
 * ずれの一覧を作る（純粋関数・テスト対象）。
 * @param {object} kintone {date: {channel: total}}
 * @param {object} fresh   {date: {channel: total}}
 * @param {string[]} dates  照合する日付
 * @param {string[]} channels 照合する販売先
 * @returns {object[]} { date, channel, before, after, diff, fixable }
 *   fixable=false は「APIが0円なのにキントーンに数字がある」ケース。
 *   取込は明細0行だと入れ替えをしないため、自動では直せない（要手動確認）。
 */
export function computeDrift(kintone, fresh, dates, channels) {
  const out = [];
  for (const d of dates) {
    for (const ch of channels) {
      const before = Math.round(kintone[d]?.[ch] ?? 0);
      const after = Math.round(fresh[d]?.[ch] ?? 0);
      const diff = after - before;
      if (diff === 0) continue;
      out.push({ date: d, channel: ch, before, after, diff, fixable: after > 0 });
    }
  }
  return out;
}

/** 販売元APIから日別合計を取り直す */
async function freshDayTotals(from, to) {
  const totals = {};
  const add = (date, ch, amount) => {
    totals[date] = totals[date] ?? {};
    totals[date][ch] = (totals[date][ch] ?? 0) + amount;
  };

  const rkOrders = await fetchRakuten(from, to);
  for (const r of rakutenRows(rkOrders, { channel: '楽天' }).rows) add(r.date, '楽天', r.amount);

  const spOrders = await fetchShopify(from, to);
  for (const r of shopifyRows(spOrders).rows) add(r.date, '自社サイト', r.amount);
  return totals;
}

/** ずれた日を取込し直す（取込スクリプトをそのまま使う＝二重防止も同じ） */
function reimport(date, channel) {
  const script = channel === '楽天' ? 'scripts/rakutenImport.js' : 'scripts/shopifyImport.js';
  execFileSync('node', [script, `--date=${date}`, '--no-notify'], {
    stdio: 'inherit',
    cwd: new URL('..', import.meta.url).pathname,
  });
}

async function notifyDrift(drifts) {
  const roomId = optional('CHATWORK_SALES_ROOM_ID') || optional('CHATWORK_ROOM_ID');
  if (!roomId || !optional('CHATWORK_API_TOKEN')) return;
  const lines = [
    '[info][title]🔍 売上検算（自動チェック）[/title]',
    'キントーンの数字と販売元の最新データにずれが見つかったため、自動で修正しました。',
    '（注文の反映遅れ・キャンセルの後処理によるもので、異常ではありません）',
    '',
    ...drifts.map((x) => {
      const sign = x.diff > 0 ? '+' : '−';
      const base = `・${x.date.slice(5).replace('-', '/')} ${x.channel}  ${yen(x.before)} → ${yen(x.after)}（${sign}${yen(Math.abs(x.diff))}）`;
      return x.fixable ? base : `${base} ⚠自動修正できません（全キャンセルの可能性・要確認）`;
    }),
    '',
    '※ 修正後の数字がキントーン「売上明細（自動取込）」に反映済みです。',
    '[/info]',
  ];
  await pushChatwork(lines.join('\n'), { roomId });
}

async function main() {
  const days = Number(arg('days', '3'));
  const app = optional('KINTONE_SALES_DETAIL_APP_ID');
  if (!app) throw new Error('KINTONE_SALES_DETAIL_APP_ID が未設定です');

  const from = daysAgoISO(days);
  const to = daysAgoISO(1);
  const dates = [];
  for (let i = days; i >= 1; i--) dates.push(daysAgoISO(i));
  const channels = ['楽天', '自社サイト'];

  console.log(`検算: ${from} 〜 ${to}（${channels.join('・')}）`);
  const [kintone, fresh] = [await kintoneDayTotals(app, from, to), await freshDayTotals(from, to)];

  const drifts = computeDrift(kintone, fresh, dates, channels);
  if (!drifts.length) {
    console.log('✅ ずれなし。キントーンの数字は販売元と一致しています。');
    return;
  }

  console.log(`⚠ ずれ ${drifts.length}件:`);
  for (const x of drifts) {
    console.log(`  ${x.date} ${x.channel}: ${x.before} → ${x.after} (${x.diff > 0 ? '+' : ''}${x.diff})${x.fixable ? '' : ' [要手動確認]'}`);
  }

  if (isDry) {
    console.log('（--dry-run のため修正・通知はしません）');
    return;
  }

  for (const x of drifts.filter((x) => x.fixable)) {
    console.log(`\n▶ ${x.date} の ${x.channel} を取込し直します …`);
    reimport(x.date, x.channel);
  }

  try {
    await notifyDrift(drifts);
    console.log('Chatworkに差分を報告しました。');
  } catch (e) {
    console.warn(`⚠ Chatwork通知に失敗（修正は完了しています）: ${e.message}`);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('salesRecheck.js');
if (isMain) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
