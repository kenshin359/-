// ============================================================
//  業務タスク：Kintone → カレンダー用データ書き出し
// ------------------------------------------------------------
//  Kintone の「業務タスク」アプリを読み、カレンダー可視化ツールが
//  読める1つのJSON（out/task-data.json）にまとめます。
//
//  実行:
//    npm run task:export
//    node scripts/exportTasks.js --out=/path/to/task-data.json
//
//  ※ Kintone は読むだけ。一切変更しません。
//  ※ 出力にはタスク内容が入るため out/ は .gitignore 済み（コミット禁止）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAllTaskRecords } from '../lib/kintone.js';
import { recordToTask, buildDataset } from '../lib/taskData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO, 'task-calendar', 'out');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const outPath = arg('out') ? path.resolve(arg('out')) : path.join(OUT_DIR, 'task-data.json');

  console.log('Kintone 業務タスクアプリからデータを取得します…');
  const records = await fetchAllTaskRecords();
  console.log(`  レコード: ${records.length}件`);

  const tasks = records.map(recordToTask).filter(Boolean);
  const skipped = records.length - tasks.length;
  if (skipped > 0) console.log(`  ※ タスク名または期日が空の ${skipped}件はスキップしました`);

  const dataset = buildDataset(tasks, new Date().toISOString());
  console.log(`  担当者: ${dataset.members.length}名 / タスク: ${dataset.tasks.length}件`);

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
