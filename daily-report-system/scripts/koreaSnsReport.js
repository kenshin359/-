#!/usr/bin/env node
// ============================================================
//  韓国SNS（明洞）の進捗・成果レポート
// ------------------------------------------------------------
//  kintoneアプリ「韓国SNS運用管理（明洞）」を読んで、
//    ・報告が遅れている／抜けている案件（🔴🟡）
//    ・撮影 → 投稿 → 広告 → 流入 → 予約 の数字
//  をまとめて表示します。--send で Chatwork にも送ります。
//
//  実行:
//    npm run korea:sns                     … 今週（月〜日）
//    npm run korea:sns -- --month=2026-09  … 指定月
//    npm run korea:sns -- --all            … 全期間
//    npm run korea:sns -- --from=2026-09-01 --to=2026-09-30
//    npm run korea:sns -- --send           … Chatwork にも送る
//    npm run korea:sns -- --json=out/korea-sns.json  … 集計をファイルに出す
//
//  ★月末にまとめてではなく、週1回＋都度で出すのが前提です。
//    「いま何をしていて、次に何をするのか」を切らさないためです。
// ============================================================
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { optional, required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { todayISO } from '../lib/date.js';
import { pushChatwork } from '../lib/chatwork.js';
import {
  normalizeRecord,
  summarize,
  formatKoreaSnsReport,
  hasBlocker,
  weekRange,
  monthRange,
} from '../lib/koreaSns.js';

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function config() {
  const url = new URL('../config/korea-sns.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

function appId() {
  const id = optional('KINTONE_KOREA_SNS_APP_ID');
  if (!id) {
    throw new Error(
      'KINTONE_KOREA_SNS_APP_ID が未設定です。\n' +
        '  `npm run create-business-apps koreasns` でアプリを作り、表示された行を .env に貼ってください。'
    );
  }
  return id;
}

function auth() {
  const token = optional('KINTONE_API_TOKEN_KOREA_SNS');
  if (token) return { 'X-Cybozu-API-Token': token };
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'kintone の認証情報がありません。\n' +
        '  KINTONE_API_TOKEN_KOREA_SNS、もしくは KINTONE_USER と KINTONE_PASSWORD を .env に設定してください。'
    );
  }
  return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
}

/** 全レコードを $id カーソルで取る（サブテーブルも一緒に返ってくる） */
async function fetchAll(app) {
  const base = required('KINTONE_BASE_URL').replace(/\/$/, '');
  const all = [];
  let lastId = 0;
  for (;;) {
    const query = encodeURIComponent(`$id > ${lastId} order by $id asc limit 100`);
    const res = await fetchWithRetry(
      `${base}/k/v1/records.json?app=${app}&query=${query}`,
      // ★GET に Content-Type を付けると kintone は 400 を返す
      { method: 'GET', headers: { ...auth() } },
      { label: 'kintone GET korea-sns records' }
    );
    const records = res.json?.records ?? [];
    if (!records.length) break;
    all.push(...records);
    lastId = Number(records[records.length - 1].$id.value);
    if (records.length < 100) break;
  }
  return all;
}

function resolvePeriod(today) {
  if (process.argv.includes('--all')) return [null, null, '韓国SNS まとめ（全期間）'];

  const month = arg('month');
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`--month は YYYY-MM 形式で: ${month}`);
    const [from, to] = monthRange(month);
    return [from, to, `韓国SNS 月次まとめ（明洞）${month}`];
  }

  const from = arg('from');
  const to = arg('to');
  if (from || to) return [from, to, '韓国SNS まとめ（明洞）'];

  const [monday, sunday] = weekRange(today);
  return [monday, sunday, '韓国SNS 週次まとめ（明洞）'];
}

async function main() {
  const cfg = config();
  const today = arg('date') || todayISO();
  const [from, to, title] = resolvePeriod(today);

  const records = (await fetchAll(appId())).map(normalizeRecord);
  const summary = summarize(records, {
    today,
    rules: cfg.rules,
    targets: cfg.targets,
    from,
    to,
  });

  const text = formatKoreaSnsReport(summary, { title });
  console.log(text);

  const jsonPath = arg('json');
  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
    console.log(`\n集計を書き出しました: ${jsonPath}`);
  }

  if (process.argv.includes('--send')) {
    const roomId =
      optional('CHATWORK_KOREA_SNS_ROOM_ID') ||
      optional('CHATWORK_ROOM_ID');
    if (!roomId) throw new Error('送信先のルームIDが未設定です（CHATWORK_KOREA_SNS_ROOM_ID など）');
    const r = await pushChatwork(text, { roomId, title });
    console.log(r.skipped ? '\n（APP_ENV=test のため送信していません）' : `\n✅ 送信しました（ルーム ${roomId}）`);
  }

  // 🔴 が残っているときは終了コード1（自動実行でも気づけるように）
  if (hasBlocker(summary)) process.exitCode = 1;
}

main().catch((e) => {
  console.error('エラー:', e.body || e.message);
  process.exit(1);
});
