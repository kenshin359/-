#!/usr/bin/env node
// ============================================================
//  朝礼台本の自動配信（毎朝7:55 → 司会・西岡さんのChatworkへ）
// ------------------------------------------------------------
//  キントーンから「昨日の売上・件数・広告費・計画比」を集め、
//  司会が読み上げるだけで進行できる15分朝礼の台本を作って送る。
//
//  ・売上: 売上明細（自動取込・クーポン後基準）
//  ・広告費: 毎朝KPI報告アプリの添付（昨日の日付のファイル）を自動解析
//  ・必要日販: (目標 − 月累計) ÷ 残り日数 を 1.1億/1.2億の両方で計算
//
//  実行: node scripts/choreiDaily.js            … 作って送る
//        node scripts/choreiDaily.js --dry-run  … 作って表示だけ
// ============================================================
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';
import { authHeadersFor } from '../lib/kintone.js';
import { salesAppId } from '../lib/salesDetailWrite.js';
import { readAdFile } from '../lib/adCsv.js';
import { pushChatwork } from '../lib/chatwork.js';
import { todayISO } from '../lib/date.js';
import { yesterdayISO } from './shopifyImport.js';
import { loadDailyPlan } from './dailyBrief.js';
import { yen } from '../lib/salesValues.js';

const isDry = process.argv.includes('--dry-run');
const TARGET_MAIN = 110000000;
const TARGET_STRETCH = 120000000;

/** 必要日販 = (目標 − 月累計) ÷ 残り日数（昨日までの実績で計算） */
export function requiredDailyPace(target, mtd, yesterdayDay, daysInMonth) {
  const remainingDays = daysInMonth - yesterdayDay;
  if (remainingDays <= 0) return null;
  return Math.max(0, Math.round((target - mtd) / remainingDays));
}

/** ファイル名が「昨日の分」か（例: 8:9 / 8：9 / 8-9 / 8月9日 / 0809） */
export function matchYesterdayFile(name, dateISO) {
  const m = Number(dateISO.slice(5, 7));
  const d = Number(dateISO.slice(8, 10));
  const pats = [
    `${m}:${d}`, `${m}：${d}`, `${m}-${d}`, `${m}/${d}`, `${m}月${d}日`,
    `${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`,
  ];
  const n = String(name);
  // 「8:9〜」のような期間まとめは対象外（〜や~を含むものは除く）
  if (n.includes('〜') || n.includes('~')) return false;
  return pats.some((p) => n.includes(p));
}

async function fetchMonthSales(yesterday) {
  const app = salesAppId();
  const monthStart = `${yesterday.slice(0, 7)}-01`;
  const records = [];
  for (let offset = 0; ; offset += 100) {
    const q = encodeURIComponent(
      `report_date >= "${monthStart}" and report_date <= "${yesterday}" order by report_date asc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    records.push(...(r.records ?? []));
    if ((r.records ?? []).length < 100) break;
  }
  let mtd = 0;
  const yday = {};
  let ydayOrders = 0;
  const dayTotals = {};
  for (const rec of records) {
    const date = rec.report_date?.value;
    for (const row of rec.detail?.value ?? []) {
      const v = row.value ?? {};
      const amt = Number(v.s_amount?.value) || 0;
      const ch = v.s_channel?.value ?? '不明';
      mtd += amt;
      dayTotals[date] = (dayTotals[date] ?? 0) + amt;
      if (date === yesterday) {
        yday[ch] = (yday[ch] ?? 0) + amt;
        ydayOrders += Number(v.s_orders?.value) || 0;
      }
    }
  }
  const days = Object.keys(dayTotals).sort();
  const last7 = days.slice(-7).map((d) => dayTotals[d]);
  const avg7 = last7.length ? Math.round(last7.reduce((s, v) => s + v, 0) / last7.length) : 0;
  return { mtd, yday, ydayOrders, avg7 };
}

async function fetchYesterdayAds(yesterday) {
  const kpiApp = optional('KINTONE_KPI_APP_ID', '30');
  const since = new Date(`${yesterday}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 1);
  const q = encodeURIComponent(
    `report_date >= "${since.toISOString().slice(0, 10)}" order by report_date desc limit 10`
  );
  const r = await call('GET', `/k/v1/records.json?app=${kpiApp}&query=${q}`);
  const base = (optional('KINTONE_BASE_URL') || '').replace(/\/$/, '');

  const byMedia = {};
  let unread = 0;
  for (const rec of r.records ?? []) {
    for (const f of rec.file_ads?.value ?? []) {
      if (!matchYesterdayFile(f.name, yesterday)) continue;
      if (/\.numbers$/i.test(f.name)) { unread++; continue; }
      const res = await fetch(`${base}/k/v1/file.json?fileKey=${encodeURIComponent(f.fileKey)}`, {
        headers: authHeadersFor(null),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      try {
        const parsed = readAdFile(buf, { filename: f.name });
        for (const row of parsed.rows ?? []) {
          // 「合計」「アカウント全体」の集計行は二重計上になるので除外
          if (/合計|アカウント全体/.test(String(row.campaign ?? ''))) continue;
          byMedia[parsed.media] = (byMedia[parsed.media] ?? 0) + (Number(row.cost) || 0);
        }
      } catch {
        unread++;
      }
    }
  }
  return { byMedia, unread };
}

/** タスク管理（チーム進捗）アプリから朝礼用のアラートを読む（未設定なら null） */
async function fetchTasks(dateISO, yesterday) {
  const app = optional('KINTONE_TASK_APP_ID', '38');
  if (!app) return null;
  try {
    const get = async (cond, order) => {
      const q = encodeURIComponent(`${cond} ${order ?? ''} limit 50`);
      const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
      return r.records ?? [];
    };
    const overdue = await get(`due < "${dateISO}" and status not in ("完了")`, 'order by due asc');
    const todayDue = await get(`due = "${dateISO}" and status not in ("完了")`, '');
    const done = await get(`status in ("完了") and 更新日時 >= "${yesterday}T00:00:00+09:00"`, '');
    const brief = (r) => ({
      tantou: r.tantou?.value ?? '',
      name: r.task_name?.value ?? '',
      due: r.due?.value ?? '',
    });
    return { overdue: overdue.map(brief), todayDue: todayDue.map(brief), doneCount: done.length };
  } catch {
    return null; // タスクアプリが読めなくても朝礼は止めない
  }
}

export function buildScript({ dateISO, yesterday, sales, ads, plan, tasks }) {
  const dow = '日月火水木金土'[new Date(`${dateISO}T00:00:00+09:00`).getDay()];
  const ydayTotal = Object.values(sales.yday).reduce((s, v) => s + v, 0);
  const planDay = plan?.days?.[yesterday]
    ? Object.values(plan.days[yesterday]).reduce((s, v) => s + v, 0)
    : null;
  const rate = planDay ? Math.round((ydayTotal / planDay) * 1000) / 10 : null;

  const yDay = Number(yesterday.slice(8, 10));
  const daysInMonth = new Date(Number(yesterday.slice(0, 4)), Number(yesterday.slice(5, 7)), 0).getDate();
  const need110 = requiredDailyPace(TARGET_MAIN, sales.mtd, yDay, daysInMonth);
  const need120 = requiredDailyPace(TARGET_STRETCH, sales.mtd, yDay, daysInMonth);
  const gap = need110 !== null ? need110 - sales.avg7 : null;

  const adsTotal = Object.values(ads.byMedia).reduce((s, v) => s + v, 0);
  const adsLine = adsTotal
    ? Object.entries(ads.byMedia).map(([m, v]) => `${m} ${yen(Math.round(v))}`).join('／')
    : '昨日分の添付が見つかりません（後で添付をお願いします）';

  const L = [];
  L.push(`🌅【リベティ朝礼】${dateISO.slice(5).replace('-', '/')}(${dow}) 司会:西岡さん 15分厳守`);
  L.push('');
  L.push('📊 0. 全体数字（60秒）');
  L.push(`・昨日${yesterday.slice(5).replace('-', '/')}の売上：${
    ['楽天', 'Amazon', '自社サイト'].filter((c) => sales.yday[c] != null)
      .map((c) => `${c} ${yen(sales.yday[c])}`).join('／') || 'データ取込待ち'
  }`);
  L.push(`　合計 ${yen(ydayTotal)}${rate !== null ? `（計画比 ${rate}%${rate >= 100 ? '✅' : '⚠️'}）` : ''}／件数 ${sales.ydayOrders}件`);
  L.push(`・8月累計：${yen(sales.mtd)}`);
  L.push(`・昨日の広告費：${adsLine}${adsTotal ? `＝計 ${yen(Math.round(adsTotal))}` : ''}`);
  if (ads.unread) L.push(`　※読めないファイル${ads.unread}件（Numbers形式等）→CSVでの添付を推奨`);
  L.push('');
  L.push('🎯 必要日販（今日の基準）');
  if (need110 !== null) L.push(`・1.1億ライン：毎日 ${yen(need110)}`);
  if (need120 !== null) L.push(`・1.2億ライン：毎日 ${yen(need120)}`);
  L.push(`・直近7日の実力：${yen(sales.avg7)}/日${gap !== null ? (gap > 0 ? ` → 毎日あと +${yen(gap)}` : ' → 貯金ペース✅') : ''}`);
  L.push('');
  if (tasks) {
    L.push('📋 タスクボード（キントーン「タスク管理」より自動）');
    if (tasks.overdue.length) {
      const top = tasks.overdue.slice(0, 5);
      L.push(`・⚠ 期限超過 ${tasks.overdue.length}件：${top.map((x) => `${x.name}（${x.tantou}・${x.due.slice(5).replace('-', '/')}期限）`).join('／')}`);
      if (tasks.overdue.length > 5) L.push(`　…ほか${tasks.overdue.length - 5}件はアプリの「⚠期限超過」ビューで`);
    } else {
      L.push('・⚠ 期限超過なし✅');
    }
    if (tasks.todayDue.length) {
      L.push(`・📅 本日期限：${tasks.todayDue.map((x) => `${x.name}（${x.tantou}）`).join('／')}`);
    }
    if (tasks.doneCount) L.push(`・✅ 昨日完了：${tasks.doneCount}件`);
    L.push('');
  }
  L.push('━━━ 各チーム報告（1チーム90秒・数字→学び→今日 の3行のみ） ━━━');
  L.push('1️⃣ 広告運用：基準 CV単価3,000円以下/クリック単価10円以下。クリアした広告は作成者名を称賛');
  L.push('2️⃣ LPチーム：イベント日程の新情報／ミンジさん・三浦さん・久保さん「今日ここまで」各1行');
  L.push('3️⃣ SNS：伸びた動画（数字と理由1行）／フォロワー増減／今日の撮影・企画');
  L.push('4️⃣ CS：低レビュー・クレーム件数／LP修正依頼（宛先指名）／出荷は問題なければ一言');
  L.push('5️⃣ TikTokライブ：昨日 配信＿時間・販売＿件／今日の課題1つ');
  L.push('6️⃣ 淵田/西岡/関本：昨日終わった・今日やる 各1行');
  L.push('7️⃣ O2ジム（阪本さん）：アクセス＿/契約＿件／共有事項');
  L.push('');
  L.push('🎯 締め（30秒）：今日の全社優先事項をひとつ宣言して解散');
  L.push('');
  L.push('【禁止】経緯説明・言い訳・その場議論（議論は「朝礼後に◯◯と◯◯で」と指名して切る）');
  return L.join('\n');
}

async function main() {
  const dateISO = todayISO();
  const yesterday = yesterdayISO(dateISO);
  const [sales, ads] = [await fetchMonthSales(yesterday), await fetchYesterdayAds(yesterday)];
  const plan = loadDailyPlan(yesterday);
  const tasks = await fetchTasks(dateISO, yesterday);
  const body = buildScript({ dateISO, yesterday, sales, ads, plan, tasks });
  console.log(body);
  if (isDry) { console.log('\n（--dry-run のため送信しません）'); return; }
  const roomId = optional('CHATWORK_CHOREI_ROOM_ID') || '433161347'; // 司会・西岡さん
  await pushChatwork(`[info][title]📣 本日の朝礼台本[/title]${body}[/info]`, { roomId });
  console.log(`\nChatwork（ルーム ${roomId}）へ送信しました`);
}

if (process.argv[1] && process.argv[1].endsWith('choreiDaily.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
