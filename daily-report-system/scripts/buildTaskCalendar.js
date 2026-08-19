// ============================================================
//  業務タスク：カレンダーHTMLの生成（実データ埋め込み）
// ------------------------------------------------------------
//  task-calendar/index.html をテンプレートに、書き出した
//  実データ（out/task-data.json）を埋め込んで
//  task-calendar/out/task-calendar.html を作ります。
//
//  実行:
//    npm run task:build                      … out/task-data.json を使う
//    node scripts/buildTaskCalendar.js --data=/path/to/task-data.json
//
//  ・データが無ければ、テンプレートをそのままコピーします
//    （サンプルデータで動く状態）。
//  ・生成HTMLにはタスク内容が入るため out/ は .gitignore 済み。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(REPO, 'task-calendar', 'index.html');
const OUT_DIR = path.join(REPO, 'task-calendar', 'out');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const PLACEHOLDER = '<!--__TASK_DATA__-->';

function main() {
  const dataPath = arg('data') ? path.resolve(arg('data')) : path.join(OUT_DIR, 'task-data.json');
  const outPath = arg('out') ? path.resolve(arg('out')) : path.join(OUT_DIR, 'task-calendar.html');

  const template = fs.readFileSync(TEMPLATE, 'utf8');
  if (!template.includes(PLACEHOLDER)) {
    console.error(`テンプレートに ${PLACEHOLDER} の差し込み位置がありません。`);
    process.exit(1);
  }

  let injected;
  if (fs.existsSync(dataPath)) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    JSON.parse(raw); // 壊れたJSONを埋め込まないよう検証
    // </script> で早期に閉じないよう、また JSON では有効だが JS リテラルを壊す
    // 行区切り(U+2028)・段落区切り(U+2029)も無害化してから埋め込む。
    const safe = raw
      .replace(/<\//g, '<\\/')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    injected = `<script>window.__TASK_DATA__ = ${safe};</script>`;
    console.log(`実データを埋め込みます: ${dataPath}`);
  } else {
    injected = '';
    console.log('実データ（task-data.json）が無いため、サンプルデータのHTMLを出力します。');
    console.log('  → 実データにするには先に npm run task:export を実行してください。');
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, template.replace(PLACEHOLDER, () => injected), 'utf8');
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`✅ 生成しました: ${outPath} (${kb}KB)`);
  console.log('  このHTMLをブラウザで開けば、実データのカレンダーが見られます。');
}

main();
