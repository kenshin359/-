// ============================================================
//  タスク報告部屋（グループチャット）を作成する
// ------------------------------------------------------------
//  スタッフがタスクを報告する専用ルームを Chatwork に作ります。
//  使い方（登録／完了／退勤の書式）を概要に書き込みます。
//
//  実行:
//    npm run task:create-room
//    node scripts/createReportRoom.js --name="【タスク報告】" --dry-run
//
//  作成後、表示された room_id を .env の CHATWORK_REPORT_ROOM に設定してください。
//  ※ 既存ルームには影響しません。新規に1つ作るだけです。
// ============================================================
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

const API_BASE = 'https://api.chatwork.com/v2';
function headers(extra = {}) {
  return { 'X-ChatWorkToken': required('CHATWORK_API_TOKEN'), ...extra };
}
function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const USAGE = [
  'このルームは各スタッフのタスク報告用です。次の書式で投稿してください。',
  '',
  '■ タスクを登録',
  '登録',
  '・提案資料作成（8/15まで）',
  '・見積もり送付',
  '',
  '■ 終わったら（完了報告）',
  '完了',
  '・提案資料作成',
  '',
  '■ 着手したら',
  '着手',
  '・見積もり送付',
  '',
  '■ 退勤時（残タスクを自動集計して返信します）',
  '退勤',
  '',
  '※ ボットが自動で処理し、本人宛てに確認を返信します。カレンダーにも反映されます。',
].join('\n');

async function main() {
  const name = arg('name') || '【タスク報告】';
  const dry = process.argv.includes('--dry-run');

  if (dry) {
    console.log(`ルーム名: ${name}\n\n── 概要（description）──\n${USAGE}\n\n(--dry-run のため作成しません)`);
    return;
  }

  // 作成者を管理者にするため自分の account_id を取得
  const me = await fetchWithRetry(`${API_BASE}/me`, { headers: headers() }, { label: 'chatwork me' });
  const adminId = me.json && me.json.account_id;
  if (!adminId) throw new Error('自分のaccount_idが取得できませんでした（トークンを確認してください）');

  const body = new URLSearchParams({
    name,
    description: USAGE,
    members_admin_ids: String(adminId),
  }).toString();

  const res = await fetchWithRetry(
    `${API_BASE}/rooms`,
    { method: 'POST', headers: headers({ 'Content-Type': 'application/x-www-form-urlencoded' }), body },
    { label: 'chatwork create room' }
  );
  const roomId = res.json && res.json.room_id;
  console.log(`✅ ルームを作成しました: 「${name}」 room_id=${roomId}`);
  console.log(`\n次の手順：`);
  console.log(`  1) .env に CHATWORK_REPORT_ROOM=${roomId} を設定`);
  console.log(`  2) スタッフをこのルームに招待`);
  console.log(`  3) npm run task:collect を定期実行（報告を回収・返信）`);
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
