// ============================================================
//  GETリクエストに Content-Type を付けていないことの回帰テスト
// ------------------------------------------------------------
//  kintone は GET に Content-Type: application/json が付いていると
//  400 (CB_IL02 Invalid request) を返します。実機で確認済みの挙動です。
//  この事故を二度と起こさないための検査です。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'backups', 'out', '.git', 'test']);

function collect(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) collect(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

test("GETリクエストに Content-Type を付けていない", () => {
  const offenders = [];
  for (const file of collect(ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // 同一行に method: 'GET' と Content-Type が両方ある = 事故のパターン
      if (/method:\s*['"]GET['"]/.test(line) && /Content-Type/i.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'GETにContent-Typeが付いています（kintoneが400を返します）:\n' + offenders.join('\n')
  );
});
