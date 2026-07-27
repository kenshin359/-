// 予想チームの土台スクリプト。
// 「次のイベント日に売上がいくらいくか」を、過去実績のリフト率から見積もる。
//
// ロジック（シンプルで説明できることを最優先）：
//   1) analyze で書き出した out/daily.json を読む
//   2) 直近の「平常日」の平均売上をチャネル別に出す（＝ベースライン）
//   3) 過去の「イベント日」が平常日の何倍だったか（リフト率）を出す
//   4) 次のイベント日（eventMaster）に、ベースライン × リフト率 を当てる
//   5) 弱気(P25)／本命／強気(P75) の3本立てで出す
//
//   実行: npm run forecast
//   基準日を変えたい場合: FORECAST_FROM=2026-08-01 npm run forecast
import { readFileSync } from 'node:fs';
import { CHANNELS } from './appSchema.js';
import { nextEventDay } from './eventMaster.js';

const yen = (x) => '¥' + Math.round(x).toLocaleString('ja-JP');
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function load() {
  try {
    return JSON.parse(readFileSync('out/daily.json', 'utf8'));
  } catch {
    throw new Error('out/daily.json がありません。先に `npm run analyze` を実行してください。');
  }
}

function main() {
  const days = load().filter((d) => d.date);
  if (days.length < 7) {
    console.log('データが少なすぎて予想できません（最低7日ぶん必要）。まずデータを溜めてください。');
    return;
  }

  const normal = days.filter((d) => !d.isEvent);
  const event = days.filter((d) => d.isEvent);

  // ベースライン（平常日）：直近30日ぶんを重視
  const recentNormal = normal.slice(-30);
  const base = {};
  for (const ch of CHANNELS) base[ch] = mean(recentNormal.map((d) => d.channels[ch].sales));
  const baseTotal = Object.values(base).reduce((s, x) => s + x, 0);

  // リフト率（イベント日 ÷ 平常日）。データが無ければ保守的に 1.0。
  const nmAvg = mean(normal.map((d) => d.sales));
  const evAvg = mean(event.map((d) => d.sales));
  const lift = nmAvg > 0 && event.length ? evAvg / nmAvg : 1.0;

  // 幅：過去イベント日の分布から P25 / P75。データが無ければベース×リフトの ±25%。
  const evSales = event.map((d) => d.sales);
  const p25 = event.length >= 4 ? quantile(evSales, 0.25) : baseTotal * lift * 0.75;
  const p75 = event.length >= 4 ? quantile(evSales, 0.75) : baseTotal * lift * 1.25;
  const mid = event.length ? evAvg : baseTotal * lift;

  // 次のイベント日
  const from = process.env.FORECAST_FROM || new Date().toISOString().slice(0, 10);
  const next = nextEventDay(from);

  console.log('\n========== 売上予想レポート（予想チーム）==========');
  console.log(`基準日: ${from}`);
  console.log(`\n【ベースライン】平常日の1日あたり平均売上（直近${recentNormal.length}日）`);
  for (const ch of CHANNELS) if (base[ch] > 0) console.log(`  ${ch.padEnd(6)} ${yen(base[ch])}`);
  console.log(`  ─────────────`);
  console.log(`  合計   ${yen(baseTotal)}`);
  console.log(
    `\n【イベント日リフト率】平常日 ${yen(nmAvg)} → イベント日 ${yen(evAvg)}  = 約 ${lift.toFixed(2)} 倍` +
      `（イベント実績 ${event.length}日 / 平常 ${normal.length}日）`
  );

  if (!next) {
    console.log('\n※ 今後60日以内に確定/推定イベントが見つかりませんでした。');
    console.log('  eventMaster.js の FIXED に次回の開催日を登録すると精度が上がります。');
  } else {
    console.log(`\n【次のイベント日】${next.date}  ${next.platforms.join('/')}  ` + `(${next.events.map((e) => e.name).join('・')})`);
    console.log('  予想売上（その日単日）:');
    console.log(`    弱気(P25)  ${yen(p25)}`);
    console.log(`    本命       ${yen(mid)}`);
    console.log(`    強気(P75)  ${yen(p75)}`);
    console.log('\n  ※ 確度は「確定日程の登録」「広告費の実績入力」でさらに上がります。');
  }
  console.log('\n=================================================\n');
}

try {
  main();
} catch (e) {
  console.error('エラー:', e.message);
  process.exit(1);
}
