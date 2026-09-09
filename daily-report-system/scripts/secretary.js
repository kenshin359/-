#!/usr/bin/env node
// ============================================================
//  AI秘書（1日タスク最適化）コマンド
// ------------------------------------------------------------
//  使い方（毎朝これだけ）:
//    タスクを書いたテキストを貼り付けて Ctrl+D
//      npm run secretary
//    ファイルから読む
//      npm run secretary -- --file=tasks.txt
//
//  1日の終わりに:
//    npm run secretary -- done "LP改修" --minutes=110   # 実績を記録
//    npm run secretary -- drop "競合分析"                # やらないと決めた
//    npm run secretary -- status                        # 今日の残り
//    npm run secretary -- review --days=30              # クセの分析
//
//  ★キントーンにも外部にも一切送信しません。手元で完結します。
//  ★記録は state/secretary/ に保存され、Git には上がりません。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDailyPlan, toRecord, toSheetJson } from '../lib/secretary/index.js';
import { formatPlan, formatReview } from '../lib/secretary/format.js';
import { savePlan, loadPlan, carryOver, markStatus, analyze, planPath, waitingItems } from '../lib/secretary/store.js';
import { humanMinutes } from '../lib/secretary/config.js';

const ARGV = process.argv.slice(2);

function flag(name, fallback = null) {
  const eq = ARGV.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = ARGV.indexOf(`--${name}`);
  if (i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--')) return ARGV[i + 1];
  return i >= 0 ? true : fallback;
}

const today = () => new Date().toISOString().slice(0, 10);

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
  });
}

const HELP = `AI秘書（1日タスク最適化）

  secretary [plan]              タスク一覧を標準入力から読んで today のプランを作る
    --file=tasks.txt            ファイルから読む
    --date=2026-09-08           日付を指定（既定は今日）
    --json                      JSONで出す（Excel生成などの連携用。--record で保存形式）
    --sheet                     Excel（out/AI秘書_YYYY-MM-DD.xlsx）も作る
    --no-save                   記録を残さない
    --no-carry                  前日の未完了を引き継がない

  secretary done "タスク名" [--minutes=90]   完了として記録
  secretary wait "タスク名" [--who=角南]      相手待ちにする（自分の時間から外す）
  secretary undone "タスク名"                 未完了に戻す
  secretary drop "タスク名"                   やらないと決めた（分析の分母から外す）
  secretary status [--date=...]              その日の進捗
  secretary review [--days=30]               ためたデータからクセを分析
  secretary carry                            明日に持ち越す予定の一覧
`;

async function cmdPlan() {
  const date = flag('date') || today();
  const file = flag('file');
  const text = file && file !== true ? fs.readFileSync(String(file), 'utf8') : await readStdin();
  if (!text.trim()) {
    console.error('タスクが空です。箇条書きを貼り付けて Ctrl+D、または --file=tasks.txt を指定してください。\n');
    console.error(HELP);
    process.exitCode = 1;
    return;
  }
  const carry = flag('no-carry') ? [] : carryOver(date);
  const stats = analyze(30);
  const plan = buildDailyPlan(text, { date, carry, waiting: waitingItems(date), stats: stats.days ? stats : null });

  if (flag('json')) {
    console.log(JSON.stringify(flag('record') ? toRecord(plan) : toSheetJson(plan), null, 1));
  } else {
    console.log(formatPlan(plan));
  }
  if (flag('sheet')) {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const r = spawnSync('python3', [path.join(dir, 'buildSecretarySheet.py')], {
      input: JSON.stringify(toSheetJson(plan)), encoding: 'utf8',
    });
    if (r.status === 0) console.log(`\n（Excel：${String(r.stdout).trim()}）`);
    else console.error(`Excelの作成に失敗しました：${r.stderr || r.error}`);
  }
  if (!flag('no-save')) {
    const p = savePlan(toRecord(plan));
    if (!flag('json')) console.log(`\n（記録：${p}）`);
  }
}

function cmdMark(status) {
  const query = ARGV.filter((a) => !a.startsWith('--'))[1];
  if (!query) { console.error('タスク名の一部を指定してください。例: secretary done "LP改修"'); process.exitCode = 1; return; }
  const date = flag('date') || today();
  const minutes = flag('minutes');
  const who = flag('who');
  const res = markStatus(date, query, status, minutes && minutes !== true ? Number(minutes) : null,
    { who: who && who !== true ? String(who) : null });
  if (!res.ok) { console.error(res.reason); process.exitCode = 1; return; }
  for (const t of res.tasks) {
    const actual = t.minutes_actual ? `（実績 ${humanMinutes(t.minutes_actual)} / 見積 ${humanMinutes(t.minutes_planned)}）` : '';
    const mark = { done: '✅', dropped: '🗑', waiting: '⏳', planned: '↩️' }[status] ?? '・';
    console.log(`${mark} ${t.title}${t.waiting_on ? `（${t.waiting_on}待ち）` : ''} ${actual}`.trimEnd());
  }
}

function cmdStatus() {
  const date = flag('date') || today();
  const plan = loadPlan(date);
  if (!plan) { console.log(`${date} の記録はまだありません。`); return; }
  const live = (plan.tasks ?? []).filter((t) => !t.deferred && t.status !== 'waiting');
  const done = live.filter((t) => t.status === 'done');
  const rest = live.filter((t) => t.status === 'planned');
  console.log(`📅 ${date}　完了 ${done.length}/${live.length}件（残り${rest.reduce((s, t) => s + (t.minutes_planned ?? 0), 0)}分）`);
  for (const t of live) {
    const mark = t.status === 'done' ? '✅' : t.status === 'dropped' ? '🗑' : t.must_do ? '🔥' : '・';
    console.log(`${mark} ${t.slot ?? '--:--'}　${t.title}（${t.category}）`);
  }
  const waits = waitingItems(date);
  if (waits.length) {
    console.log('\n⏳ 相手待ち');
    for (const w of waits) console.log(`・${w.title}（${w.who ?? '相手'}待ち・${w.days === 0 ? '本日から' : `${w.days}日経過`}）`);
  }
  const deferred = (plan.tasks ?? []).filter((t) => t.deferred);
  if (deferred.length) console.log(`\n⏭ 今日やらないと決めたもの：${deferred.map((t) => t.title).join('、')}`);
}

function cmdCarry() {
  const list = carryOver(flag('date') || today());
  if (list.length === 0) { console.log('持ち越しはありません。'); return; }
  console.log('前回から終わっていない仕事：');
  for (const c of list) console.log(`・${c.title}（${c.carry_count}回目 / ${c.carried_from} から）`);
}

async function main() {
  const cmd = ARGV.find((a) => !a.startsWith('--')) ?? 'plan';
  switch (cmd) {
    case 'plan': return cmdPlan();
    case 'done': return cmdMark('done');
    case 'wait': return cmdMark('waiting');
    case 'undone': return cmdMark('planned');
    case 'drop': return cmdMark('dropped');
    case 'status': return cmdStatus();
    case 'carry': return cmdCarry();
    case 'review': return console.log(formatReview(analyze(Number(flag('days', 30)) || 30)));
    case 'help': case '--help': return console.log(HELP);
    default:
      console.error(`知らないコマンド: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('secretary.js')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { planPath };
