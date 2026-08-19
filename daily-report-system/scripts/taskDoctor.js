// ============================================================
//  業務タスク連携のセットアップ確認（task:doctor）
// ------------------------------------------------------------
//  .env の設定と、Chatwork への接続・ルームアクセスを点検します。
//  何も変更しません（GETのみ）。「やってみる」前の確認用。
//
//  実行: npm run task:doctor
// ============================================================
import { optional } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

const API = 'https://api.chatwork.com/v2';
const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const ng = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const dim = (s) => `\x1b[90m${s}\x1b[0m`;

function isSet(v) {
  return v && v !== 'TODO' && v !== '要設定';
}

async function chatworkGet(pathname, token) {
  const res = await fetchWithRetry(`${API}${pathname}`, { headers: { 'X-ChatWorkToken': token } }, { label: `doctor ${pathname}`, retries: 1 });
  return res.json;
}

async function main() {
  console.log('\n=== 業務タスク連携 セットアップ確認 ===\n');

  const token = optional('CHATWORK_API_TOKEN');
  const reportRoom = optional('CHATWORK_REPORT_ROOM');
  const sourceRooms = optional('CHATWORK_TASK_SOURCE_ROOMS');
  const minutesRooms = optional('CHATWORK_MINUTES_ROOMS');
  const notifyRoom = optional('CHATWORK_TASK_ROOM_ID') || optional('CHATWORK_ROOM_ID');
  const anthropic = optional('ANTHROPIC_API_KEY');

  console.log('[設定]');
  console.log(isSet(token) ? ok('CHATWORK_API_TOKEN') : ng('CHATWORK_API_TOKEN（Chatwork連携に必須）'));
  console.log(isSet(reportRoom) ? ok(`CHATWORK_REPORT_ROOM = ${reportRoom}（タスク報告部屋）`) : dim('・CHATWORK_REPORT_ROOM 未設定（報告部屋を使う場合に設定）'));
  console.log(isSet(sourceRooms) ? ok(`CHATWORK_TASK_SOURCE_ROOMS = ${sourceRooms}`) : dim('・CHATWORK_TASK_SOURCE_ROOMS 未設定（未設定なら全ルームから収集）'));
  console.log(isSet(minutesRooms) ? ok(`CHATWORK_MINUTES_ROOMS = ${minutesRooms}（議事録抽出）`) : dim('・CHATWORK_MINUTES_ROOMS 未設定（議事録抽出を使う場合に設定）'));
  console.log(isSet(notifyRoom) ? ok(`通知先ルーム = ${notifyRoom}`) : dim('・通知先ルーム（CHATWORK_TASK_ROOM_ID）未設定'));
  console.log(isSet(anthropic) ? ok('ANTHROPIC_API_KEY（議事録AI抽出が有効）') : dim('・ANTHROPIC_API_KEY 未設定（議事録は簡易ルール抽出になります）'));

  if (!isSet(token)) {
    console.log('\n' + ng('Chatworkトークンが無いため接続確認はスキップします。'));
    console.log(dim('  .env に CHATWORK_API_TOKEN を設定してから再実行してください。\n'));
    return;
  }

  console.log('\n[接続]');
  try {
    const me = await chatworkGet('/me', token);
    console.log(ok(`Chatwork接続OK（${me.name || me.account_id}）`));
  } catch (e) {
    console.log(ng(`Chatwork接続に失敗: ${e.message}`));
    console.log(dim('  トークンが正しいか、権限があるか確認してください。\n'));
    return;
  }

  const rooms = new Set();
  [reportRoom, notifyRoom].forEach((r) => isSet(r) && rooms.add(r.trim()));
  [sourceRooms, minutesRooms].forEach((list) => isSet(list) && list.split(',').forEach((r) => r.trim() && rooms.add(r.trim())));

  if (rooms.size) {
    console.log('\n[ルームアクセス]');
    for (const rid of rooms) {
      try {
        const info = await chatworkGet(`/rooms/${encodeURIComponent(rid)}`, token);
        console.log(ok(`room ${rid}: ${info.name || '(名称不明)'}`));
      } catch (e) {
        console.log(ng(`room ${rid}: アクセス不可（${e.status || e.message}）`));
      }
    }
  }

  console.log('\n準備OKなら:  npm run task:collect  →  npm run task:chatwork:sync\n');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
