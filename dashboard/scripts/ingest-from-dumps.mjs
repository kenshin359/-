// GitHub Actions のログ（A-J符号化ダンプ）から取込用JSONを作り、ダッシュボードの /api/pro/ingest へ送る。
// 使い方: node scripts/ingest-from-dumps.mjs --sku=<monthlySkuDailyのログ> --ad=<adCostReport dumpのログ> --url=https://... --secret=...
//   ログはそのまま（A-J のまま）渡してよい。復号はここで行う。
// 元データ: ===DAILY_CH_B===（日別×媒体 売上）、===DAILY_SC_SALES_B===（スーツケース系 日別売上）、
//           ===DAILY_CH_UNITS_B===（日別×媒体×商品 個数）、===ADCOST_DAILY_B===（日別×媒体 広告費）
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
// A-J → 数字。「全体が A-J とハイフンだけの引用文字列」（日付・日）と「引用されていない A-J の値」だけを復号する
// （"Amazon" のような単語は触らない）
const dec = (t) => t.replace(/[A-J]/g, (c) => String('ABCDEFGHIJ'.indexOf(c)));
const decode = (s) =>
  s
    .replace(/"([A-J][A-J-]*)"/g, (_, t) => `"${dec(t)}"`)
    .replace(/([:\[,]\s*)([A-J]+)(?=\s*[,}\]])/g, (_, pre, t) => pre + dec(t));
function marker(text, name) {
  const lines = text.split('\n').map((l) => l.replace(/^\S+T\S+Z\s+/, ''));
  const i = lines.findIndex((l) => l.trim() === `===${name}===`);
  if (i < 0 || !lines[i + 1]) return null;
  return JSON.parse(decode(lines[i + 1].trim()));
}
const dayToDate = (month, d) => `${month}-${String(Number(d)).padStart(2, '0')}`;
const SUITCASE = new Set(['スーツケースS', 'スーツケースM', 'スーツケースL', 'クラシックアルミ', '多機能アルミ', 'アルミ(型式未確認)']);
const CH = { 楽天: 'Rakuten', Amazon: 'Amazon', 自社サイト: 'Own' };

const kpi = new Map();
const cpa = new Map();
const adDays = new Set(); // 主媒体（メタ/AZ/RPP）の広告費が揃っている日
const row = (m, d, init) => m.get(d) ?? (m.set(d, init(d)), m.get(d));
const kpiInit = (date) => ({ date, salesRakuten: 0, salesAmazon: 0, salesOwn: 0, adGoogle: 0, adRakuten: 0, adAmazon: 0, adMeta: 0 });
const cpaInit = (date) => ({ date, suitcaseSales: null, meta: 0, amazonAds: 0, rpp: 0, google: 0, other: 0, unitsAmazon: 0, unitsRakuten: 0, unitsOwn: 0 });

if (args.sku) {
  const t = readFileSync(args.sku, 'utf8');
  const ch = marker(t, 'DAILY_CH_B');
  if (ch?.dailyCh) {
    for (const [date, byCh] of Object.entries(ch.dailyCh)) {
      const r = row(kpi, date, kpiInit);
      for (const [c, v] of Object.entries(byCh)) {
        const k = CH[c];
        if (k) r[`sales${k}`] += Math.round(Number(v) || 0);
      }
    }
  }
  const sc = marker(t, 'DAILY_SC_SALES_B');
  if (sc?.dailyScSales) for (const [date, v] of Object.entries(sc.dailyScSales)) row(cpa, date, cpaInit).suitcaseSales = Math.round(Number(v) || 0);
  const units = marker(t, 'DAILY_CH_UNITS_B');
  if (units?.dailyChUnits) {
    for (const [date, byCh] of Object.entries(units.dailyChUnits)) {
      const r = row(cpa, date, cpaInit);
      for (const [c, byProd] of Object.entries(byCh)) {
        const k = CH[c];
        if (!k) continue;
        for (const [prod, q] of Object.entries(byProd)) if (SUITCASE.has(prod)) r[`units${k}`] += Math.round(Number(q) || 0);
      }
    }
  }
}
if (args.ad) {
  const t = readFileSync(args.ad, 'utf8');
  const ad = marker(t, 'ADCOST_DAILY_B');
  if (ad?.daily) {
    const month = String(ad.month);
    const KEY = { trav: 'adMeta', cat: 'adMeta', az: 'adAmazon', rpp: 'adRakuten', google: 'adGoogle' };
    const CKEY = { trav: 'meta', cat: 'meta', az: 'amazonAds', rpp: 'rpp', google: 'google' };
    for (const [media, byDay] of Object.entries(ad.daily)) {
      if (!KEY[media]) continue;
      for (const [day, v] of Object.entries(byDay)) {
        const date = dayToDate(month, day);
        const n = Math.round(Number(v) || 0);
        row(kpi, date, kpiInit)[KEY[media]] += n;
        row(cpa, date, cpaInit)[CKEY[media]] += n;
        if (media !== 'google') adDays.add(date);
      }
    }
  }
}
// 広告費の主媒体（メタ/AZ/RPP）の CSV がまだ添付されていない日（Google の日別ファイルだけ月末まで行がある）は
// 0円として扱わない: 合算CPA行は送らず「未入力」のままにし、売上行にはその旨をメモする。翌日の取込で上書きされる。
if (args.ad) {
  for (const [date, r] of kpi) if (!adDays.has(date)) r.note = '広告費（メタ/AZ/RPP）未添付・Google分のみ';
  for (const date of [...cpa.keys()]) if (!adDays.has(date)) cpa.delete(date);
}
// 未来日（Google の日別ファイルは月末まで行がある）と存在しない日付（9/31 など）は捨てる。今日（JST）までだけ取り込む
const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const validDate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= todayJst) return false; // 当日分は翌朝に確定するため含めない
  const [y, m, day] = d.split('-').map(Number);
  return day >= 1 && day <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const payload = {
  source: 'github-actions',
  kpiDaily: [...kpi.values()].filter((r) => validDate(r.date)).sort((a, b) => a.date.localeCompare(b.date)),
  cpaDaily: [...cpa.values()].filter((r) => validDate(r.date)).sort((a, b) => a.date.localeCompare(b.date)),
};
console.error(`kpiDaily ${payload.kpiDaily.length}件 / cpaDaily ${payload.cpaDaily.length}件`);
if (args.out) { const { writeFileSync } = await import('node:fs'); writeFileSync(args.out, JSON.stringify(payload)); }
if (args.url && args.secret) {
  const res = await fetch(`${args.url.replace(/\/$/, '')}/api/pro/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${args.secret}` }, body: JSON.stringify(payload) });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
} else if (!args.out) {
  console.log(JSON.stringify(payload).slice(0, 400) + '…');
}
