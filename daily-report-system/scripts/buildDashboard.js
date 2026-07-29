// ============================================================
//  ダッシュボードHTMLの生成
// ------------------------------------------------------------
//  dashboard/template.html に、書き出したデータを埋め込んで
//  out/dashboard.html を作ります。
//
//  実行:
//    npm run dashboard              … データ取得から一気に
//    npm run dashboard -- --data=out/dashboard-data.json
//
//  ★テンプレートはリポジトリに入れますが、
//    実データが入る out/ は .gitignore 済みです。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const dataPath = arg('data')
  ? path.resolve(arg('data'))
  : path.join(ROOT, 'out', 'dashboard-data.json');
const outPath = arg('out') ? path.resolve(arg('out')) : path.join(ROOT, 'out', 'dashboard.html');

if (!fs.existsSync(dataPath)) {
  console.error(`データがありません: ${dataPath}\n  先に npm run dashboard:data を実行してください。`);
  process.exit(1);
}

const template = fs.readFileSync(path.join(ROOT, 'dashboard', 'template.html'), 'utf8');
const raw = fs.readFileSync(dataPath, 'utf8');
JSON.parse(raw); // 壊れたJSONを埋め込まないよう先に検証する

// <script type="application/json"> の中身が早期に閉じないようにする
const safe = raw.replace(/<\//g, '<\\/');

if (!template.includes('__DATA__')) {
  console.error('テンプレートに __DATA__ の差し込み位置がありません。');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, template.replace('__DATA__', () => safe), 'utf8');

const kb = Math.round(fs.statSync(outPath).size / 1024);
console.log(`✅ 生成しました: ${outPath} (${kb}KB)`);
