// 予想チームの予測エンジン。
// 「次のイベント日に、どのチャネルでいくら売れるか」を、
// ★チャネル × イベント種別ごとの倍率★ で見積もる（楽天特化にブラッシュアップ済み）。
//
// 考え方（説明できることを最優先）：
//   1) analyze が書き出した out/daily.json を読む
//   2) 平常日の平均売上をチャネル別に出す（＝ベースライン。直近を重視）
//   3) 過去イベント日を「チャネル × 種別(マラソン/スーパーSALE/5と0…)」で束ね、
//      それぞれ平常日の何倍だったか（倍率）とサンプル数・確度を出す
//   4) 次のイベント日の種別を暦から判定し、チャネルごとに一番効く倍率を当てる
//   5) 弱気(P25)／本命／強気(P75) の3本立てで出す
//
//   実行:            npm run forecast
//   基準日を変える:   FORECAST_FROM=2026-08-01 npm run forecast
//   主役チャネル変更: FORECAST_FOCUS=Amazon npm run forecast   （既定: 楽天）
import { readFileSync } from 'node:fs';
import { CHANNELS } from './appSchema.js';
import { nextEventDay, classifyDate, categorizeEvent } from './eventMaster.js';

const FOCUS = process.env.FORECAST_FOCUS || '楽天';
const TARGET_ROAS = Number(process.env.TARGET_ROAS || 5);

const yen = (x) => '¥' + Math.round(x).toLocaleString('ja-JP');
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const round2 = (x) => Math.round(x * 100) / 100;
function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
// サンプル数から確度ラベル
const confidence = (n) => (n >= 6 ? '高' : n >= 3 ? '中' : n >= 1 ? '低(暫定)' : 'データ無');

function load() {
  try {
    return JSON.parse(readFileSync('out/daily.json', 'utf8'));
  } catch {
    throw new Error('out/daily.json がありません。先に `npm run analyze` を実行してください。');
  }
}

// その日に効いているイベント種別の集合を返す（記録のイベント名＋暦の推定を統合）
function typesOfDay(d) {
  const set = new Set();
  for (const e of classifyDate(d.date).events) set.add(e.type);
  if (d.eventName) {
    // 記録された（社長が入力した）イベント名も種別化して足す
    for (const part of String(d.eventName).split(/[・,、\/]/)) {
      const t = categorizeEvent(null, part.trim());
      if (t && t !== 'その他') set.add(t);
    }
  }
  return set;
}

function main() {
  const days = load().filter((d) => d.date);
  if (days.length < 7) {
    console.log('データが少なすぎて予想できません（最低7日ぶん必要）。まずデータを溜めてください。');
    console.log('→ kintone 接続後 `npm run analyze`、または過去データを共有してください。');
    return;
  }

  const normal = days.filter((d) => !d.isEvent);
  const event = days.filter((d) => d.isEvent);

  // ── ① ベースライン（平常日）：直近30日を重視 ──
  const recentNormal = normal.slice(-30);
  const base = {};
  for (const ch of CHANNELS) base[ch] = mean(recentNormal.map((d) => d.channels[ch].sales));
  const baseTotal = Object.values(base).reduce((s, x) => s + x, 0);

  // ── ② チャネル × 種別ごとの倍率テーブル ──
  // liftTable[type][channel] = { lift, n, salesSamples[] }
  const liftTable = {};
  for (const d of event) {
    for (const type of typesOfDay(d)) {
      const row = (liftTable[type] ||= {});
      for (const ch of CHANNELS) {
        const cell = (row[ch] ||= { samples: [] });
        cell.samples.push(d.channels[ch].sales);
      }
      const tot = (row.__total ||= { samples: [] });
      tot.samples.push(d.sales);
    }
  }
  for (const type of Object.keys(liftTable)) {
    for (const ch of CHANNELS) {
      const cell = liftTable[type][ch];
      cell.n = cell.samples.filter((x) => x > 0).length;
      cell.lift = base[ch] > 0 ? round2(mean(cell.samples) / base[ch]) : null;
    }
  }
  // 種別に依らないチャネル全体のイベント倍率（フォールバック用）
  const chEventLift = {};
  for (const ch of CHANNELS) {
    const evMean = mean(event.map((d) => d.channels[ch].sales));
    chEventLift[ch] = base[ch] > 0 ? round2(evMean / base[ch]) : null;
  }
  const globalLift = mean(normal.map((d) => d.sales)) > 0 ? round2(mean(event.map((d) => d.sales)) / mean(normal.map((d) => d.sales))) : 1;

  // チャネル×種別の倍率を、フォールバック付きで解決する
  function resolveLift(ch, type) {
    const cell = liftTable[type]?.[ch];
    if (cell && cell.n >= 2 && cell.lift != null) return { lift: cell.lift, n: cell.n, src: '種別実績' };
    if (chEventLift[ch] != null) return { lift: chEventLift[ch], n: event.filter((d) => d.channels[ch].sales > 0).length, src: 'チャネル全体' };
    return { lift: globalLift, n: event.length, src: '全体平均' };
  }

  // ── ③ 楽天ブラッシュアップ：主役チャネルの種別別倍率を一覧表示 ──
  console.log('\n============================================================');
  console.log(`  売上予想レポート（予想チーム）  主役: ${FOCUS}`);
  console.log('============================================================');
  console.log(`\n■ ${FOCUS} の平常日ベースライン: ${yen(base[FOCUS] || 0)} /日（直近${recentNormal.length}日平均）`);
  console.log(`\n■ ${FOCUS} のイベント種別ごとの倍率（平常日=1.00）`);
  const focusTypes = Object.keys(liftTable).filter((t) => t.startsWith(FOCUS + '_'));
  if (!focusTypes.length) {
    console.log('   （まだ種別ごとの実績がありません。イベント日のデータが溜まると自動で埋まります）');
  } else {
    for (const t of focusTypes.sort()) {
      const cell = liftTable[t][FOCUS];
      const label = t.replace(FOCUS + '_', '');
      console.log(
        `   ${label.padEnd(14)} × ${String(cell.lift ?? '—').padStart(5)}倍  ` +
          `→ 見込み ${yen((base[FOCUS] || 0) * (cell.lift || 0))}  [n=${cell.n} 確度${confidence(cell.n)}]`
      );
    }
  }

  // ── ④ 次のイベント日を予想 ──
  const from = process.env.FORECAST_FROM || new Date().toISOString().slice(0, 10);
  const next = nextEventDay(from);
  console.log('\n------------------------------------------------------------');
  if (!next) {
    console.log(`※ ${from} から60日以内に確定/推定イベントが見つかりません。`);
    console.log('  src/eventMaster.js の FIXED に次回の開催日を登録すると精度が上がります。');
  } else {
    console.log(`■ 次のイベント日: ${next.date}  [${next.platforms.join('/')}]  ${next.events.map((e) => e.name).join('・')}`);
    const dayTypes = next.types;

    // チャネルごとに、その日の種別のうち一番効く倍率を採用
    const perCh = {};
    for (const ch of CHANNELS) {
      if ((base[ch] || 0) <= 0) continue;
      let best = { lift: 1, n: 0, src: '—', type: '平常' };
      for (const type of dayTypes) {
        const r = resolveLift(ch, type);
        if (r.lift > best.lift) best = { ...r, type };
      }
      // その日に主役チャネルの種別が無くても、チャネル全体のイベント倍率は当てる
      if (best.lift === 1 && chEventLift[ch] != null) best = { lift: chEventLift[ch], n: 0, src: 'チャネル全体', type: 'イベント一般' };
      perCh[ch] = { forecast: (base[ch] || 0) * best.lift, ...best };
    }
    const midTotal = Object.values(perCh).reduce((s, c) => s + c.forecast, 0);

    console.log('\n  【チャネル別予想（本命）】');
    for (const ch of CHANNELS) {
      if (!perCh[ch]) continue;
      const c = perCh[ch];
      console.log(
        `   ${ch.padEnd(6)} ${yen(c.forecast).padStart(12)}  ` +
          `(×${c.lift} / ${c.type.replace(FOCUS + '_', '')} / ${c.src} / 確度${confidence(c.n)})`
      );
    }
    console.log(`   ─────────────`);
    console.log(`   合計   ${yen(midTotal).padStart(12)}`);

    // 幅：主役の該当種別の分布から。無ければ ±25%
    const dominantType = dayTypes.find((t) => t.startsWith(FOCUS + '_')) || dayTypes[0];
    const totalSamples = liftTable[dominantType]?.__total?.samples || [];
    const p25 = totalSamples.length >= 4 ? quantile(totalSamples, 0.25) : midTotal * 0.75;
    const p75 = totalSamples.length >= 4 ? quantile(totalSamples, 0.75) : midTotal * 1.25;
    console.log('\n  【単日レンジ】');
    console.log(`   弱気(P25)  ${yen(p25)}`);
    console.log(`   本命       ${yen(midTotal)}`);
    console.log(`   強気(P75)  ${yen(p75)}`);

    // 広告プラン：目標ROASから逆算
    console.log(`\n  【広告プラン】目標ROAS ${TARGET_ROAS} で本命を取りにいくなら`);
    console.log(`   投下広告費の目安: ${yen(midTotal / TARGET_ROAS)}（＝本命売上 ÷ ${TARGET_ROAS}）`);
  }
  console.log('\n============================================================\n');
}

try {
  main();
} catch (e) {
  console.error('エラー:', e.message);
  process.exit(1);
}
