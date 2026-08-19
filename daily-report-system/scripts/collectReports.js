// ============================================================
//  タスク報告部屋の回収（登録・完了・着手・退勤を処理）
// ------------------------------------------------------------
//  CHATWORK_REPORT_ROOM のメッセージを読み、スタッフの
//  「登録／完了／着手／退勤」コマンドを処理してタスクを更新します。
//  各コマンドには本人宛て（[To:]）で確認を返信します。
//  定期実行（cron/n8n で数分おき）を想定。
//
//  実行:
//    npm run task:collect                    … APP_ENV=test なら返信せずプレビュー
//    APP_ENV=production npm run task:collect
//    node scripts/collectReports.js --data=fixture.json   … メッセージJSONから（Chatwork不要）
//
//  ※ Chatwork のメッセージは読むだけ。返信の投稿のみ行います。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { required, optional, isProduction } from '../lib/env.js';
import { pushChatwork } from '../lib/chatwork.js';
import { fetchRoomMessages, cleanBody } from '../lib/chatworkMessages.js';
import { parseCommand } from '../lib/taskCommands.js';
import { loadStore, saveStore, applyCommand } from '../lib/reportStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function localKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadMessages(room) {
  const dataArg = arg('data');
  if (dataArg) return JSON.parse(fs.readFileSync(path.resolve(dataArg), 'utf8'));
  return fetchRoomMessages(room);
}

async function main() {
  const room = arg('room') || required('CHATWORK_REPORT_ROOM');
  const todayKey = arg('date') || localKey(new Date());

  const messages = await loadMessages(room);
  messages.sort((a, b) => Number(a.send_time || 0) - Number(b.send_time || 0));

  const store = loadStore();
  const replies = [];
  let handled = 0;

  for (const m of messages) {
    const messageId = m.message_id;
    if (store.processed.includes(String(messageId))) continue;
    const sender = (m.account && m.account.name) || '不明';
    const accountId = m.account && m.account.account_id;
    const dateKey = m.send_time ? localKey(new Date(Number(m.send_time) * 1000)) : todayKey;
    const body = cleanBody(m.body || '');
    const command = parseCommand(body, { todayKey });

    if (!command) {
      // コマンドでないメッセージは処理済みにだけして無視
      store.processed.push(String(messageId));
      continue;
    }
    const res = applyCommand(store, { sender, messageId, dateKey, command, todayKey, room });
    handled++;
    if (res.reply) {
      const mention = accountId ? `[To:${accountId}] ${sender}さん\n` : '';
      replies.push(mention + res.reply);
    }
  }

  saveStore(store);
  const open = store.tasks.filter((t) => t.status !== 'done').length;
  console.log(`処理: ${handled}件 / 現在の未完了タスク: ${open}件 / 全: ${store.tasks.length}件`);

  if (!replies.length) {
    console.log('返信すべき内容はありませんでした。');
    return;
  }
  if (!isProduction()) {
    console.log('※ APP_ENV=test のため返信は送信しません。プレビュー:\n');
    replies.forEach((r) => console.log('── 返信 ──\n' + r + '\n'));
    return;
  }
  for (const r of replies) {
    await pushChatwork(r, { roomId: room, decorate: false });
  }
  console.log(`→ ${replies.length}件の確認を返信しました（room=${room}）`);
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
