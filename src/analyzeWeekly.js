// 「SNS/LP週次報告（新）」から数値を取得して、週次サマリー（投稿数の推移など）を出力する。
// ここで得たきれいな数値・区分をもとに、Claude が振り返り・打ち手の提案まで行う。
//   実行: npm run analyze-weekly
import { kintone, qs } from './client.js';

const NEW = process.env.KINTONE_WEEKLY_APP_ID;

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
const s = (rec, code) => rec[code]?.value || '';
const rows = (rec, code) => rec[code]?.value || [];

async function main() {
  if (!NEW) throw new Error('KINTONE_WEEKLY_APP_ID が未設定です（.env を確認）');

  const records = await fetchAll(NEW);
  if (!records.length) {
    console.log('データがありません。先に migrate-weekly を実行してください。');
    return;
  }

  // 週（期間開始日）× チームで集計
  const weeks = new Map();
  for (const r of records) {
    const start = s(r, 'period_start');
    if (!start) continue;
    const w = weeks.get(start) || { SNS: null, LP: null };
    w[s(r, 'team') || 'SNS'] = {
      posts: n(r, 'posts_total'),
      breakdown: rows(r, 'posts').length,
      topics: rows(r, 'sections').length,
    };
    weeks.set(start, w);
  }

  console.log('\n=== 週次サマリー ===');
  for (const [start, w] of [...weeks].sort()) {
    const sns = w.SNS ? `SNS ${w.SNS.posts}投稿(内訳${w.SNS.breakdown}/トピック${w.SNS.topics})` : 'SNS -';
    const lp = w.LP ? `LP トピック${w.LP.topics}` : 'LP -';
    console.log(`${start}週  ${sns}  |  ${lp}`);
  }

  // アカウント別 投稿数の累計（SNSの内訳テーブルから）
  const byAccount = new Map();
  for (const r of records) {
    if (s(r, 'team') !== 'SNS') continue;
    for (const row of rows(r, 'posts')) {
      const acc = row.value?.account?.value || '(不明)';
      const cnt = Number(row.value?.count?.value || 0);
      byAccount.set(acc, (byAccount.get(acc) || 0) + cnt);
    }
  }
  if (byAccount.size) {
    console.log('\n=== アカウント別 投稿数（累計）===');
    for (const [acc, cnt] of [...byAccount].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${acc.padEnd(24)} ${String(cnt).padStart(4)} 投稿`);
    }
  }

  // きれいな数値・区分を JSON でも書き出す（Claude 分析の入力に使える）
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('out', { recursive: true });
  const flat = records.map((r) => ({
    period_start: s(r, 'period_start'),
    period_end: s(r, 'period_end'),
    team: s(r, 'team'),
    posts_total: n(r, 'posts_total'),
    posts: rows(r, 'posts').map((x) => ({
      account: x.value?.account?.value || '',
      count: Number(x.value?.count?.value || 0),
    })),
    sections: rows(r, 'sections').map((x) => ({
      title: x.value?.title?.value || '',
      done: x.value?.done?.value || '',
      next: x.value?.next?.value || '',
    })),
    summary: s(r, 'summary'),
    next_week: s(r, 'next_week'),
    mtg: s(r, 'mtg'),
  }));
  writeFileSync('out/weekly.json', JSON.stringify(flat, null, 2));
  console.log('\nきれいな数値・区分を out/weekly.json に書き出しました（分析用）。');
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
