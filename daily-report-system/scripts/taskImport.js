#!/usr/bin/env node
// ============================================================
//  タスク管理（チーム進捗）アプリへのタスク一括登録（汎用）
// ------------------------------------------------------------
//  会議のアクションアイテムなどをまとめて登録する共通スクリプト。
//  タスクは環境変数 TASKS_B64（base64のJSON配列）で受け取ります。
//  公開リポジトリのため、コードやログには中身を出しません。
//
//  JSONの形:
//    [{team,tantou,task_name,done_def,priority,impact,due,status,yanai,memo}, ...]
//  同じタスク名が既にあればスキップします（重複防止）。
// ============================================================
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const app = arg('app', '') || optional('KINTONE_TASK_APP_ID', '38');
  const b64 = process.env.TASKS_B64 || '';
  if (!b64.trim()) throw new Error('TASKS_B64 が空です');
  const items = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

  const existing = new Set();
  const r = await call('GET', `/k/v1/records.json?app=${app}&query=${encodeURIComponent('limit 500')}`);
  for (const rec of r.records ?? []) existing.add(rec.task_name?.value);

  const records = items
    .filter((t) => t.task_name && !existing.has(t.task_name))
    .map((t) => ({
      ...(t.team ? { team: { value: t.team } } : {}),
      ...(t.tantou ? { tantou: { value: t.tantou } } : {}),
      task_name: { value: t.task_name },
      ...(t.done_def ? { done_def: { value: t.done_def } } : {}),
      ...(t.priority ? { priority: { value: t.priority } } : {}),
      ...(t.impact ? { impact: { value: t.impact } } : {}),
      ...(t.due ? { due: { value: t.due } } : {}),
      ...(t.status ? { status: { value: t.status } } : {}),
      ...(t.yanai ? { yanai: { value: t.yanai } } : {}),
      ...(t.memo ? { memo: { value: t.memo } } : {}),
    }));

  const skipped = items.length - records.length;
  if (!records.length) {
    console.log(`追加なし（全${items.length}件が登録済みのためスキップ）`);
    return;
  }
  for (let i = 0; i < records.length; i += 100) {
    await call('POST', '/k/v1/records.json', { app, records: records.slice(i, i + 100) });
  }
  console.log(`✅ タスクを${records.length}件登録しました（重複スキップ${skipped}件）`);
}

main().catch((e) => {
  console.error('エラー:', e.message, JSON.stringify(e.body ?? '').slice(0, 300));
  process.exit(1);
});
