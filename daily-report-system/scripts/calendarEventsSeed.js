#!/usr/bin/env node
// ============================================================
//  ECイベント日程を会社カレンダー（統合）に一括登録
// ------------------------------------------------------------
//  楽天公式イベントカレンダー・Amazonセール告知（いずれも公開情報）
//  の日程を、会社カレンダーアプリに「イベント」種別で登録します。
//  同じ日付＋タイトルが既にあればスキップ（何度実行しても安全）。
//  実行: node scripts/calendarEventsSeed.js [--dry-run]
// ============================================================
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';

const DRY = process.argv.includes('--dry-run');

/** from〜to の各日に同じタイトルのレコードを作る */
function span(from, to, title, detail) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push({ date: d.toISOString().slice(0, 10), title, detail });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const one = (date, title, detail) => [{ date, title, detail }];

// ---- 2026年8月（楽天公式カレンダー・Amazon告知より）----
const EVENTS = [
  ...one('2026-08-01', '🛒ワンダフルデー', '楽天・毎月1日はポイントアップ'),
  ...one('2026-08-02', '🛒お買い物マラソン プレ開始', '8/2(日)10:00〜 本番前の仕込み・予約'),
  ...span('2026-08-04', '2026-08-10', '🛒お買い物マラソン 本番', '8/4(火)20:00〜8/11(火)01:59'),
  ...one('2026-08-11', '🛒お買い物マラソン 最終', '〜8/11(火)01:59（深夜クローズ）'),
  ...one('2026-08-18', '🛒ご愛顧感謝デー', '全ショップ対象 ポイント最大4倍'),
  ...one('2026-08-22', '🛒お買い物マラソン プレ開始', '8/22(土)10:00〜 本番前の仕込み・予約'),
  ...span('2026-08-24', '2026-08-26', '🛒お買い物マラソン 本番', '8/24(月)20:00〜8/27(木)09:59'),
  ...one('2026-08-27', '🛒お買い物マラソン 最終', '〜8/27(木)09:59（朝クローズ）'),
  ...span('2026-08-28', '2026-08-31', '📦Amazonスマイルセール', '8/28(金)09:00〜9/3(木)23:59'),
  ...one('2026-08-28', '🛒スーパーSALE プレ開始', '8/28(金)10:00〜 9月スーパーSALEの仕込み'),
  ...one('2026-08-05', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-08-10', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-08-15', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-08-20', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-08-25', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-08-30', '🛒5と0のつく日', 'ポイントアップ'),

  // ---- 2026年9月 ----
  ...span('2026-09-01', '2026-09-03', '📦Amazonスマイルセール', '〜9/3(木)23:59'),
  ...one('2026-09-01', '🛒ワンダフルデー', '楽天・毎月1日はポイントアップ'),
  ...span('2026-09-04', '2026-09-10', '🛒楽天スーパーSALE 本番', '9/4(金)20:00〜9/11(金)01:59'),
  ...one('2026-09-11', '🛒楽天スーパーSALE 最終', '〜9/11(金)01:59（深夜クローズ）'),
  ...one('2026-09-17', '🛒お買い物マラソン プレ開始', '9/17(木)10:00〜9/19(土)19:59'),
  ...one('2026-09-18', '🛒ご愛顧感謝デー', '全ショップ対象 ポイントアップ'),
  ...span('2026-09-19', '2026-09-23', '🛒お買い物マラソン 本番', '9/19(土)20:00〜9/24(木)01:59'),
  ...one('2026-09-24', '🛒お買い物マラソン 最終', '〜9/24(木)01:59（深夜クローズ）'),
  ...one('2026-09-05', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-09-10', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-09-15', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-09-20', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-09-25', '🛒5と0のつく日', 'ポイントアップ'),
  ...one('2026-09-30', '🛒5と0のつく日', 'ポイントアップ'),
];

async function main() {
  const app = optional('KINTONE_CALENDAR_APP_ID', '44');

  const existing = new Set();
  let offset = 0;
  for (;;) {
    const q = encodeURIComponent(`limit 500 offset ${offset}`);
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    for (const rec of r.records ?? []) {
      existing.add(`${rec.event_date?.value}|${rec.title?.value}`);
    }
    if ((r.records ?? []).length < 500) break;
    offset += 500;
  }

  const records = EVENTS.filter((e) => !existing.has(`${e.date}|${e.title}`)).map((e) => ({
    event_date: { value: e.date },
    title: { value: e.title },
    cal_kind: { value: 'イベント' },
    detail: { value: e.detail ?? '' },
  }));

  const skipped = EVENTS.length - records.length;
  if (DRY) {
    console.log(`[dry-run] 追加予定 ${records.length}件 / 登録済みスキップ ${skipped}件`);
    return;
  }
  if (!records.length) {
    console.log(`追加なし（全${EVENTS.length}件が登録済み）`);
    return;
  }
  for (let i = 0; i < records.length; i += 100) {
    await call('POST', '/k/v1/records.json', { app, records: records.slice(i, i + 100) });
  }
  console.log(`✅ イベントを${records.length}件登録しました（重複スキップ${skipped}件）`);
}

main().catch((e) => {
  console.error('エラー:', e.message, JSON.stringify(e.body ?? '').slice(0, 300));
  process.exit(1);
});
