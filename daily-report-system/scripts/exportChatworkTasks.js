// ============================================================
//  Chatwork のタスク → カレンダー用データ書き出し
// ------------------------------------------------------------
//  各スタッフの Chatwork タスクを集めて、カレンダー可視化ツールが
//  読む1つのJSON（out/task-data.json）にまとめます。
//  毎日これを実行 → npm run task:build でカレンダーが最新になります。
//
//  実行:
//    npm run task:chatwork            … 取得 → out/task-data.json
//    npm run task:chatwork:sync       … 取得 → HTML生成まで一気に
//
//  取得するルーム:
//    CHATWORK_TASK_SOURCE_ROOMS=428303793,443746924  … カンマ区切りで指定
//    未設定なら、参加している全ルームからタスクを集めます。
//    完了タスクも含めたい場合: --with-done
//
//  ※ Chatwork は読むだけ。タスクの内容は変更しません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { optional } from '../lib/env.js';
import { fetchRooms, fetchRoomTasks, chatworkTasksToTasks } from '../lib/chatworkTasks.js';
import { fetchRoomMessages, messagesToText } from '../lib/chatworkMessages.js';
import { extractTasks } from '../lib/taskExtract.js';
import { loadStore, storeTasksToCalendar } from '../lib/reportStore.js';
import { buildDataset } from '../lib/taskData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO, 'task-calendar', 'out');

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

async function resolveRooms() {
  const configured = optional('CHATWORK_TASK_SOURCE_ROOMS');
  if (configured) {
    return configured
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => ({ room_id: id, name: id }));
  }
  console.log('CHATWORK_TASK_SOURCE_ROOMS が未設定のため、参加中の全ルームから集めます…');
  return fetchRooms();
}

async function main() {
  const outPath = arg('out') ? path.resolve(arg('out')) : path.join(OUT_DIR, 'task-data.json');
  const todayKey = arg('date') || localKey(new Date());
  const statuses = has('with-done') ? ['open', 'done'] : ['open'];

  const rooms = await resolveRooms();
  console.log(`対象ルーム: ${rooms.length}件 / ステータス: ${statuses.join(', ')}`);

  const all = [];
  for (const r of rooms) {
    try {
      const tasks = await fetchRoomTasks(r.room_id, statuses);
      if (tasks.length) console.log(`  ・${r.name || r.room_id}: ${tasks.length}件`);
      all.push(...tasks);
    } catch (e) {
      console.warn(`  ⚠ ルーム ${r.room_id} のタスク取得に失敗: ${e.message}`);
    }
  }

  // A) Chatworkの「タスク」機能から
  const taskA = chatworkTasksToTasks(all, { todayKey });
  console.log(`A) タスク機能から: ${taskA.length}件`);

  // B) 議事録メッセージ本文からタスク抽出（CHATWORK_MINUTES_ROOMS が設定されている場合）
  let taskB = [];
  const minutesRooms = optional('CHATWORK_MINUTES_ROOMS');
  if (minutesRooms) {
    const rids = minutesRooms.split(',').map((s) => s.trim()).filter(Boolean);
    console.log(`B) 議事録ルームから抽出: ${rids.join(', ')}`);
    for (const rid of rids) {
      try {
        const msgs = await fetchRoomMessages(rid);
        const text = messagesToText(msgs, { maxChars: 16000 });
        if (!text) { console.log(`  ・${rid}: メッセージなし`); continue; }
        const { tasks, method } = await extractTasks(text, { todayKey });
        console.log(`  ・${rid}: ${tasks.length}件（抽出方法: ${method}）`);
        taskB.push(...tasks);
      } catch (e) {
        console.warn(`  ⚠ ルーム ${rid} の議事録抽出に失敗: ${e.message}`);
      }
    }
  }

  // C) タスク報告部屋（登録・完了・退勤）のストアから
  const taskC = storeTasksToCalendar(loadStore(), { todayKey });
  if (taskC.length) console.log(`C) タスク報告部屋から: ${taskC.length}件`);

  // A + B + C を統合（担当者|タスク名|期日 が同じものは1つに）
  const merged = [];
  const seen = new Set();
  for (const t of [...taskA, ...taskB, ...taskC]) {
    const key = `${t.memberName}|${t.title}|${t.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }

  const dataset = buildDataset(merged, new Date().toISOString(), 'Chatwork');
  console.log(`\n合計 担当者: ${dataset.members.length}名 / タスク: ${dataset.tasks.length}件（A:${taskA.length} + B:${taskB.length} + C:${taskC.length} − 重複）`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(dataset), 'utf8');
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`✅ 書き出しました: ${outPath} (${kb}KB)`);
  console.log('  次に npm run task:build でカレンダーHTMLを生成できます。');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
