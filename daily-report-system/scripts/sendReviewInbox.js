#!/usr/bin/env node
// ============================================================
//  返信待ちレビューPDFをChatworkへ送る
// ------------------------------------------------------------
//  out/review-inbox.pdf を、指定した名前のルームに投稿します。
//  ルームIDが分からなくても、ルーム名（部分一致）で探します。
//
//  実行: node scripts/sendReviewInbox.js --room=CSレビューチーム
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { required } from '../lib/env.js';
import { uploadChatworkFile } from '../lib/chatwork.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, '..'), 'out');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** ルーム一覧から名前で探す（完全一致→部分一致の順） */
export function findRoom(rooms, name) {
  const exact = rooms.find((r) => r.name === name);
  if (exact) return exact;
  const partial = rooms.filter((r) => (r.name ?? '').includes(name));
  return partial.length === 1 ? partial[0] : null;
}

async function main() {
  const roomName = arg('room', 'CSレビューチーム');
  const roomIdArg = arg('room-id', '');
  const token = required('CHATWORK_API_TOKEN');

  let roomId = roomIdArg;
  if (!roomId) {
    const res = await fetch('https://api.chatwork.com/v2/rooms', {
      headers: { 'X-ChatWorkToken': token },
    });
    if (!res.ok) throw new Error(`ルーム一覧の取得に失敗 (${res.status})`);
    const rooms = await res.json();
    const hit = findRoom(rooms, roomName);
    if (!hit) {
      throw new Error(
        `「${roomName}」というルームが見つかりません（候補${rooms.length}件中）。` +
          'ルーム名を確認するか、--room-id=数字 で直接指定してください。'
      );
    }
    roomId = String(hit.room_id);
    console.log(`ルーム「${hit.name}」(${roomId}) に送ります`);
  }

  const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'review-inbox.json'), 'utf8')).meta;
  const pdf = fs.readFileSync(path.join(OUT, 'review-inbox.pdf'));
  const count = JSON.parse(fs.readFileSync(path.join(OUT, 'review-inbox.json'), 'utf8')).reviews.length;
  const low = JSON.parse(fs.readFileSync(path.join(OUT, 'review-inbox.json'), 'utf8'))
    .reviews.filter((r) => r.star <= 3).length;

  const message = [
    `[info][title]📝 返信待ちレビュー一覧（${meta.target}）[/title]`,
    `期間: ${meta.from} 〜 ${meta.to}`,
    `未返信: ${count}件（うち★3以下 ${low}件 → PDFの先頭にあります。優先対応をお願いします）`,
    '返信は RMS →「レビューチェックツール」から。対応が終わったらこのメッセージにリアクションをお願いします。',
    '[/info]',
  ].join('\n');

  await uploadChatworkFile({
    buffer: pdf,
    fileName: `返信待ちレビュー_${meta.from.replace(/\//g, '')}-${meta.to.replace(/\//g, '')}.pdf`,
    contentType: 'application/pdf',
    message,
    roomId,
  });
  console.log('送信しました');
}

if (process.argv[1] && process.argv[1].endsWith('sendReviewInbox.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
