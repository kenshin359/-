// ============================================================
//  緊急即時通知（ワークフロー②のローカル版）
// ------------------------------------------------------------
//  緊急案件を1件受け取り → Claude要約 → LINE即時通知。
//  Webhook 経由（n8n）でも、手動でも実行できます。
//
//  実行:  node scripts/urgentNotify.js --file=samples/sample-urgent.json
//         echo '{"what":"...","owner":"..."}' | node scripts/urgentNotify.js
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeUrgent } from '../lib/claude.js';
import { formatUrgentLine } from '../lib/format.js';
import { notify, describeResults } from '../lib/notify.js';
import { todayISO } from '../lib/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function readInput() {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  if (fileArg) {
    return JSON.parse(fs.readFileSync(path.resolve(ROOT, fileArg.slice('--file='.length)), 'utf8'));
  }
  // 標準入力から
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new Error('入力がありません（--file= か 標準入力 でJSONを渡してください）');
  return JSON.parse(raw);
}

async function main() {
  const incident = await readInput();
  console.log('緊急案件を要約します…');

  // Claude で通知文の要素を整える（失敗しても素の値でフォールバック）
  let summary;
  try {
    summary = await summarizeUrgent(incident);
  } catch (e) {
    console.warn('Claude要約に失敗、元データで通知します:', e.message);
    summary = incident;
  }

  const text = formatUrgentLine(summary, todayISO());
  const { results, anySent } = await notify(text, { urgent: true });
  console.log(`緊急通知: ${describeResults(results)}`);
  if (!anySent) process.exitCode = 1;
}

main().catch((e) => {
  console.error('緊急通知エラー:', e.message);
  process.exit(1);
});
