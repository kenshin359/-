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

  const tasks = chatworkTasksToTasks(all, { todayKey });
  const dataset = buildDataset(tasks, new Date().toISOString(), 'Chatwork');
  console.log(`\n担当者: ${dataset.members.length}名 / タスク: ${dataset.tasks.length}件`);

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
