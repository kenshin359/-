// ============================================================
//  業務タスク：進捗の随時通知（着手・完了・遅延・停滞）
// ------------------------------------------------------------
//  Kintone の「業務タスク」を定期的に読み、前回からの変化を
//  検知して Chatwork に通知します。Webhook不要。
//  cron や n8n から数分〜数十分おきに実行してください。
//
//  通知する変化:
//    🚀 着手  … 未着手/遅延 → 進行中
//    ✅ 完了  … → 完了
//    ⚠ 遅延  … 期限超過（未完了）／ステータスが遅延に
//    ⏰ 未着手（要着手）… 未着手のまま期限が近い（既定: 2日以内）
//
//  実行:
//    npm run task:watch                 … APP_ENV=test なら送らずプレビュー
//    APP_ENV=production npm run task:watch
//    node scripts/watchTasks.js --data=out/task-data.json   … JSONから（Kintone不要）
//    node scripts/watchTasks.js --baseline                  … 現状を基準として保存（通知しない）
//
//  通知先:  CHATWORK_TASK_ROOM_ID（無ければ CHATWORK_ROOM_ID）
//  状態保存: state/task-status.json（.gitignore 済み）
//
//  ※ Kintone は読むだけ。一切変更しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { optional, isProduction } from '../lib/env.js';
import { pushChatwork } from '../lib/chatwork.js';
import { fetchAllTaskRecords } from '../lib/kintone.js';
import { recordToTask, diffEvents, formatEvents } from '../lib/taskData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '..', 'state', 'task-status.json');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function has(flag) {
  return process.argv.includes(`--${flag}`);
}
function localKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}
function saveState(snapshot) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(snapshot), 'utf8');
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
  const stallDays = arg('stall-days') ? Number(arg('stall-days')) : 2;
  const tasks = await loadTasks();

  const prevState = loadState();

  // 初回（スナップショット無し）or --baseline: 通知せず現状だけ保存
  if (!prevState || has('baseline')) {
    const { next } = diffEvents({}, tasks, { todayKey, stallDays });
    // baseline では立ち上がりフラグを現状に合わせる（次回から差分だけ通知）
    saveState(next);
    console.log(`基準を保存しました（${tasks.length}件）。次回から変化だけ通知します。`);
    return;
  }

  const { events, next } = diffEvents(prevState, tasks, { todayKey, stallDays });
  const text = formatEvents(events, { todayKey });

  if (!text) {
    saveState(next);
    console.log('変化はありませんでした（通知なし）。');
    return;
  }

  const room = optional('CHATWORK_TASK_ROOM_ID') || optional('CHATWORK_ROOM_ID');
  const hasOverdue = events.some((e) => e.type === 'overdue');

  if (!isProduction()) {
    console.log('※ APP_ENV=test のため送信せずプレビューします。\n');
    console.log('── プレビュー ──\n' + text + '\n');
  } else if (!room) {
    console.log('通知先（CHATWORK_TASK_ROOM_ID / CHATWORK_ROOM_ID）が未設定です。');
    console.log('── 未送信の内容 ──\n' + text + '\n');
  } else {
    await pushChatwork(text, { roomId: room, mentionAll: hasOverdue });
    console.log(`→ Chatwork へ通知しました（room=${room}${hasOverdue ? ' / [toall]' : ''}） ${events.length}件`);
  }

  // 通知できた（またはプレビューした）ら状態を更新
  saveState(next);
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
