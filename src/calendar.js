// 直近のイベント暦を表示する（予想チーム・社長の作戦会議用）。
//   実行: npm run calendar
//   起点を変える: CAL_FROM=2026-08-01 CAL_DAYS=60 npm run calendar
import { calendarFrom, RECURRING } from './eventMaster.js';

const from = process.env.CAL_FROM || new Date().toISOString().slice(0, 10);
const days = Number(process.env.CAL_DAYS || 45);

console.log(`\n=== イベント暦 ${from} から ${days}日間 ===`);
const cal = calendarFrom(from, days);
const hits = cal.filter((d) => d.isEvent);
if (!hits.length) {
  console.log('（この期間に確定/推定イベントはありません。eventMaster.js の FIXED に登録してください）');
} else {
  for (const d of hits) {
    console.log(`  ${d.date}  [${d.platforms.join('/')}]  ${d.events.map((e) => `${e.name}(${e.source})`).join('・')}`);
  }
}

console.log('\n=== 定期イベント一覧（傾向）===');
for (const [platform, list] of Object.entries(RECURRING)) {
  console.log(`\n■ ${platform}`);
  for (const e of list) console.log(`  ・${e.name}（${e.cadence}・約${e.typicalDays}日）— ${e.note}`);
}
console.log('');
