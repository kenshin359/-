#!/usr/bin/env node
// ============================================================
//  CSVがそろっているか確認して知らせる
// ------------------------------------------------------------
//  「日次CSV提出ボックス」を見て、8つのうち何が足りないかを
//  Chatwork に知らせます。
//
//  実行:
//    npm run intake:check                  … 今日ぶんを画面に表示
//    npm run intake:check -- --send        … Chatwork にも送る
//    npm run intake:check -- --date=2026-07-31
//    npm run intake:check -- --create      … 今日の受け皿レコードが無ければ作る
//
//  ★そろっているときも送ります。
//    「連絡が来ない＝チェックが動いていない」と区別がつかないためです。
// ============================================================
import { checkDay, createDay, formatIntakeCheck, intakeAppId } from '../lib/intake.js';
import { todayISO } from '../lib/date.js';
import { pushChatwork } from '../lib/chatwork.js';
import { optional } from '../lib/env.js';

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

async function main() {
  const app = intakeAppId();
  const date = arg('date') || todayISO();

  let check = await checkDay(date, app);

  // 受け皿が無ければ作る（スタッフが「新規作成」を押す手間を省く）
  if (!check.exists && process.argv.includes('--create')) {
    await createDay(date, app);
    console.log(`${date} の受け皿レコードを作成しました。`);
    check = await checkDay(date, app);
  }

  const text = formatIntakeCheck(check, { weekday: weekdayOf(date) });
  console.log(text);

  if (process.argv.includes('--send')) {
    const roomId =
      optional('CHATWORK_INTAKE_ROOM_ID') ||
      optional('CHATWORK_SALES_ROOM_ID') ||
      optional('CHATWORK_ROOM_ID');
    if (!roomId) throw new Error('送信先のルームIDが未設定です（CHATWORK_INTAKE_ROOM_ID など）');
    const r = await pushChatwork(text, { roomId, title: `CSV提出チェック ${date}` });
    console.log(r.skipped ? '\n（APP_ENV=test のため送信していません）' : `\n✅ 送信しました（ルーム ${roomId}）`);
  }

  // 足りないものがあるときは終了コードを1にする（自動実行で気づけるように）
  if (!check.allDone && check.status !== '対象外(休業日)') process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('intakeCheck.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(2);
  });
}
