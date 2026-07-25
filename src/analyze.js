// 「売上日報（新）」から数値を取得して、月次サマリー・転換率の推移などを出力する。
// ここで得たきれいな数値をもとに、Claude が原因分析・打ち手の提案まで行う。
//   実行: npm run analyze
import { kintone, qs } from './client.js';

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

const n = (rec, code) => Number(rec[code]?.value || 0);
const yen = (x) => '¥' + Math.round(x).toLocaleString('ja-JP');

async function main() {
  if (!NEW) throw new Error('KINTONE_NEW_APP_ID が未設定です（.env を確認）');

  const records = await fetchAll(NEW);
  if (!records.length) {
    console.log('データがありません。先に migrate を実行してください。');
    return;
  }

  // 月次に集計
  const months = new Map();
  for (const r of records) {
    const date = r.date?.value || '';
    const ym = date.slice(0, 7);
    if (!ym) continue;
    const m = months.get(ym) || { days: 0, rakuten: 0, amazon: 0, own: 0, rkAccess: 0, rkCvrSum: 0 };
    m.days += 1;
    m.rakuten += n(r, 'sales_rakuten');
    m.amazon += n(r, 'sales_amazon');
    m.own += n(r, 'sales_own');
    m.rkAccess += n(r, 'rk_access');
    m.rkCvrSum += n(r, 'rk_cvr');
    months.set(ym, m);
  }

  console.log('\n=== 月次サマリー ===');
  for (const [ym, m] of [...months].sort()) {
    const total = m.rakuten + m.amazon + m.own;
    const avgCvr = m.days ? (m.rkCvrSum / m.days).toFixed(2) : '0';
    console.log(
      `${ym}  合計 ${yen(total).padStart(12)}  ` +
        `(楽天 ${yen(m.rakuten)} / Amazon ${yen(m.amazon)} / 自社 ${yen(m.own)})  ` +
        `楽天平均転換率 ${avgCvr}%  [${m.days}日]`
    );
  }

  // きれいな数値を JSON でも書き出す（Claude 分析の入力に使える）
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('out', { recursive: true });
  const flat = records.map((r) => ({
    date: r.date?.value,
    sales_total: n(r, 'sales_total') || n(r, 'sales_rakuten') + n(r, 'sales_amazon') + n(r, 'sales_own'),
    sales_rakuten: n(r, 'sales_rakuten'),
    sales_amazon: n(r, 'sales_amazon'),
    sales_own: n(r, 'sales_own'),
    rk_access: n(r, 'rk_access'),
    rk_cvr: n(r, 'rk_cvr'),
    rk_fav: n(r, 'rk_fav'),
    az_access: n(r, 'az_access'),
    az_cvr: n(r, 'az_cvr'),
  }));
  writeFileSync('out/daily.json', JSON.stringify(flat, null, 2));
  console.log('\nきれいな数値を out/daily.json に書き出しました（分析用）。');
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
