// 分析チームの土台スクリプト。
// 「売上日報（新）」（チャネル別実績テーブル）から数値を取得し、
//   ・月次サマリー（売上・広告費・ROAS）
//   ・チャネル別サマリー
//   ・イベント日 vs 平常日の比較
// を出力し、分析用のきれいな数値を out/ に書き出す。
// ここで得た数値をもとに、分析チーム（.claude/agents）が原因分析と打ち手提案を行う。
//   実行: npm run analyze
import { kintone, qs } from './client.js';
import { CHANNELS } from './appSchema.js';
import { classifyDate } from './eventMaster.js';

const NEW = process.env.KINTONE_NEW_APP_ID;

async function fetchAll(app) {
  const all = [];
  let last = 0;
  for (;;) {
    const query = `$id > ${last} order by $id asc limit 100`;
    const r = await kintone('GET', `/k/v1/records.json?${qs({ app, query })}`);
    const recs = r.records || [];
    if (!recs.length) break;
    all.push(...recs);
    last = Number(recs[recs.length - 1].$id.value);
    if (recs.length < 100) break;
  }
  return all;
}

const n = (rec, code) => Number(rec?.[code]?.value || 0);
const yen = (x) => '¥' + Math.round(x).toLocaleString('ja-JP');
const roas = (sales, cost) => (cost > 0 ? sales / cost : null);
const pct = (x) => (x == null ? '—' : (x * 100).toFixed(0) + '%');

// 1レコード（1日）を、扱いやすいフラットな形に変換する
function flattenDay(r) {
  const date = r.date?.value || '';
  const rows = r.results?.value || [];
  const channels = {};
  for (const ch of CHANNELS) channels[ch] = { sales: 0, adcost: 0, units: 0, access: 0, cvr: null };
  for (const row of rows) {
    const c = row.value || {};
    const ch = c.channel?.value;
    if (!channels[ch]) continue;
    channels[ch].sales += n(c, 'ch_sales');
    channels[ch].adcost += n(c, 'ch_adcost');
    channels[ch].units += n(c, 'ch_units');
    channels[ch].access += n(c, 'ch_access');
    const cvr = c.ch_cvr?.value;
    if (cvr !== undefined && cvr !== '') channels[ch].cvr = Number(cvr);
  }
  const sales = Object.values(channels).reduce((s, c) => s + c.sales, 0);
  const adcost = Object.values(channels).reduce((s, c) => s + c.adcost, 0);

  // イベント情報：レコードに入っていればそれを優先、無ければ暦から推定
  const recEventPlatform = r.event_platform?.value;
  const recEventName = r.event_name?.value;
  const cls = classifyDate(date);
  const isEvent = (recEventPlatform && recEventPlatform !== 'なし') || cls.isEvent;
  const eventName = recEventName || cls.events.map((e) => e.name).join('・') || '';

  return { date, ym: date.slice(0, 7), channels, sales, adcost, isEvent, eventName };
}

function main_print(days) {
  // ── 月次サマリー ──
  const months = new Map();
  for (const d of days) {
    if (!d.ym) continue;
    const m = months.get(d.ym) || { days: 0, sales: 0, adcost: 0 };
    m.days += 1;
    m.sales += d.sales;
    m.adcost += d.adcost;
    months.set(d.ym, m);
  }
  console.log('\n=== 月次サマリー（売上 / 広告費 / ROAS）===');
  for (const [ym, m] of [...months].sort()) {
    console.log(
      `${ym}  売上 ${yen(m.sales).padStart(13)}  広告費 ${yen(m.adcost).padStart(11)}  ` +
        `ROAS ${roas(m.sales, m.adcost) ? roas(m.sales, m.adcost).toFixed(1) : '—'}  [${m.days}日]`
    );
  }

  // ── チャネル別サマリー（全期間）──
  const chTotals = {};
  for (const ch of CHANNELS) chTotals[ch] = { sales: 0, adcost: 0, units: 0 };
  for (const d of days)
    for (const ch of CHANNELS) {
      chTotals[ch].sales += d.channels[ch].sales;
      chTotals[ch].adcost += d.channels[ch].adcost;
      chTotals[ch].units += d.channels[ch].units;
    }
  console.log('\n=== チャネル別サマリー（全期間）===');
  for (const ch of CHANNELS) {
    const t = chTotals[ch];
    if (!t.sales && !t.adcost) continue;
    console.log(
      `${ch.padEnd(6)}  売上 ${yen(t.sales).padStart(13)}  広告費 ${yen(t.adcost).padStart(11)}  ` +
        `ROAS ${roas(t.sales, t.adcost) ? roas(t.sales, t.adcost).toFixed(1) : '—'}`
    );
  }

  // ── イベント日 vs 平常日 ──
  const ev = { n: 0, sales: 0 };
  const nm = { n: 0, sales: 0 };
  for (const d of days) (d.isEvent ? ev : nm).sales += d.sales, (d.isEvent ? ev : nm).n++;
  const evAvg = ev.n ? ev.sales / ev.n : 0;
  const nmAvg = nm.n ? nm.sales / nm.n : 0;
  console.log('\n=== イベント日 vs 平常日（1日あたり平均売上）===');
  console.log(`平常日   ${yen(nmAvg).padStart(13)}  [${nm.n}日]`);
  console.log(`イベント日 ${yen(evAvg).padStart(13)}  [${ev.n}日]`);
  if (nmAvg > 0) console.log(`→ イベント日は平常日の約 ${(evAvg / nmAvg).toFixed(2)} 倍（リフト率 ${pct(evAvg / nmAvg - 1)}）`);

  return { evAvg, nmAvg, lift: nmAvg > 0 ? evAvg / nmAvg : null };
}

async function main() {
  if (!NEW) throw new Error('KINTONE_NEW_APP_ID が未設定です（.env を確認）');

  const records = await fetchAll(NEW);
  if (!records.length) {
    console.log('データがありません。先に migrate を実行してください。');
    return;
  }
  const days = records.map(flattenDay).filter((d) => d.date);
  const summary = main_print(days);

  // きれいな数値を JSON で書き出す（予想チーム・分析チームの入力）
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('out', { recursive: true });
  writeFileSync('out/daily.json', JSON.stringify(days, null, 2));
  writeFileSync('out/summary.json', JSON.stringify(summary, null, 2));
  console.log('\nきれいな数値を out/daily.json / out/summary.json に書き出しました（各チームの分析入力）。');
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
