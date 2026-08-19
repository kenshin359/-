// ============================================================
//  kintone「お知らせ」貼り付け用HTMLを生成
// ------------------------------------------------------------
//  タスクデータから、kintoneのお知らせ欄に貼れるHTML（inline styleのみ）を
//  作ります。出力ファイルの中身をコピーして、
//  kintone: アプリ設定 → お知らせ（または一覧の説明/ポータル）に貼り付けます。
//
//  実行:
//    npm run task:notice                         … out/task-data.json から生成
//    node scripts/buildKintoneNotice.js --data=path/to/task-data.json
//
//  データが無ければ、先に取得してください:
//    npm run task:chatwork   もしくは  npm run task:export
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildNoticeHTML } from '../lib/kintoneNotice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO, 'task-calendar', 'out');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function localKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function main() {
  const dataPath = arg('data') ? path.resolve(arg('data')) : path.join(OUT_DIR, 'task-data.json');
  const outPath = arg('out') ? path.resolve(arg('out')) : path.join(OUT_DIR, 'kintone-notice.html');
  const todayKey = arg('date') || localKey(new Date());

  if (!fs.existsSync(dataPath)) {
    console.error(`データがありません: ${dataPath}`);
    console.error('  先に npm run task:chatwork または npm run task:export を実行してください。');
    process.exit(1);
  }
  const dataset = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const html = buildNoticeHTML(dataset, { todayKey });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`✅ お知らせ用HTMLを生成しました: ${outPath}`);
  console.log('  このファイルの中身をコピーして、kintoneのお知らせ欄に貼り付けてください。');
  console.log('  （お知らせはHTML編集モードで貼り付け。scriptやstyleタグは使っていません）');
}

main();
