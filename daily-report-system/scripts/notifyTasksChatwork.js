// ============================================================
//  業務タスク：Chatwork 通知
// ------------------------------------------------------------
//  Kintone の「業務タスク」を読み、その日の締切・遅延をまとめて
//  Chatwork に通知します。毎朝の定期実行を想定。
//
//  実行:
//    npm run task:notify              … 実行（APP_ENV=test なら送らずプレビュー）
//    APP_ENV=production npm run task:notify   … 実際に送信
//    node scripts/notifyTasksChatwork.js --data=out/task-data.json  … JSONから（Kintone不要）
//
//  通知先:
//    CHATWORK_ROOM_ID                … 全体サマリーの送信先（必須）
//    CHATWORK_ROOM_<TEAM>            … チーム別に分けたい場合（任意）
//        例) CHATWORK_ROOM_AD, CHATWORK_ROOM_LP, CHATWORK_ROOM_CS …
//        <TEAM> は honbu/ad/sns/lp/cs/exec/tiktok/part（大文字）
//
//  ※ Kintone は読むだけ。一切変更しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { optional, isProduction } from '../lib/env.js';
import { pushChatwork } from '../lib/chatwork.js';
import { fetchAllTaskRecords } from '../lib/kintone.js';
import { recordToTask, buildDigest, formatDigest, TEAMS } from '../lib/taskData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function localKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadTasks() {
  const dataArg = arg('data');
  if (dataArg) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(dataArg), 'utf8'));
    return raw.tasks || [];
  }
  const records = await fetchAllTaskRecords();
  return records.map(recordToTask).filter(Boolean);
}

async function main() {
  const todayKey = arg('date') || localKey(new Date());
  const tasks = await loadTasks();
  console.log(`対象タスク: ${tasks.length}件 / 基準日: ${todayKey}`);
  if (!isProduction()) console.log('※ APP_ENV=test のため、実際には送信せずプレビューします。\n');

  // ① 全体サマリー → CHATWORK_ROOM_ID
  const overall = buildDigest(tasks, { todayKey });
  const overallText = formatDigest(overall, { title: `【業務タスク】本日の締切・遅延サマリー ${todayKey}` });
  const mainRoom = optional('CHATWORK_TASK_ROOM_ID') || optional('CHATWORK_ROOM_ID');
  if (mainRoom) {
    // 遅延が1件でもあれば全員宛て（[toall]）で注意喚起
    const mentionAll = overall.overall.overdue.length > 0;
    await pushChatwork(overallText, { roomId: mainRoom, mentionAll });
    console.log(`→ 全体サマリーを送信（room=${mainRoom}${mentionAll ? ' / [toall]' : ''}）`);
  } else {
    console.log('CHATWORK_ROOM_ID が未設定のため、全体サマリーは送信しません。');
    console.log('── プレビュー ──\n' + overallText + '\n');
  }

  // ② チーム別ルームが設定されていれば、そのチームだけのサマリーを送る
  let teamSent = 0;
  for (const tm of TEAMS) {
    const room = optional(`CHATWORK_ROOM_${tm.id.toUpperCase()}`);
    if (!room) continue;
    const teamTasks = tasks.filter((t) => t.dept === tm.id);
    const dg = buildDigest(teamTasks, { todayKey });
    if (dg.overall.dueToday.length === 0 && dg.overall.overdue.length === 0) continue; // 何も無ければ送らない
    const text = formatDigest(dg, { title: `【${tm.name}】本日の締切・遅延 ${todayKey}` });
    await pushChatwork(text, { roomId: room, mentionAll: dg.overall.overdue.length > 0 });
    console.log(`→ ${tm.name} を送信（room=${room}）`);
    teamSent++;
  }
  if (teamSent === 0) console.log('チーム別ルーム（CHATWORK_ROOM_<TEAM>）は未設定、または対象なしでした。');

  console.log('\n完了。');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
