#!/usr/bin/env node
// ============================================================
//  返信パック（エクセル）をChatworkのCSルームへ送る
// ------------------------------------------------------------
//  送り先は CHATWORK_CS_ROOM_ID（Secrets）を最優先。
//  無ければルーム名（--room=）で探し、それでも無ければ
//  いつもの売上ルームに候補一覧を知らせます。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { required, optional } from '../lib/env.js';
import { uploadChatworkFile, pushChatwork } from '../lib/chatwork.js';
import { findRoom, candidateRooms } from './sendReviewInbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, '..'), 'out');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const roomName = arg('room', 'CSレビューチーム');
  let roomId = arg('room-id', '') || optional('CHATWORK_CS_ROOM_ID');
  const token = required('CHATWORK_API_TOKEN');

  if (!roomId) {
    const res = await fetch('https://api.chatwork.com/v2/rooms', {
      headers: { 'X-ChatWorkToken': token },
    });
    if (!res.ok) throw new Error(`ルーム一覧の取得に失敗 (${res.status})`);
    const rooms = await res.json();
    const hit = findRoom(rooms, roomName);
    if (!hit) {
      const cands = candidateRooms(rooms, roomName);
      const fallbackRoom = optional('CHATWORK_SALES_ROOM_ID') || optional('CHATWORK_ROOM_ID');
      if (fallbackRoom) {
        await pushChatwork(
          `[info][title]⚠ 返信パックを送れませんでした[/title]「${roomName}」というルームが見つかりません。` +
            (cands.length ? `\n近そうなルーム:\n${cands.map((r) => `・${r.name}（ID: ${r.room_id}）`).join('\n')}` : '') +
            '\n[/info]',
          { roomId: fallbackRoom }
        );
      }
      throw new Error(`「${roomName}」というルームが見つかりません`);
    }
    roomId = String(hit.room_id);
  }

  const pack = JSON.parse(fs.readFileSync(path.join(OUT, 'reply-pack.json'), 'utf8'));
  const { meta } = pack;
  const xlsx = fs.readFileSync(path.join(OUT, 'reply-pack.xlsx'));

  const message = [
    '[info][title]📝 レビュー返信パック（コピペで返信できます）[/title]',
    `期間: ${meta.from} 〜 ${meta.to} の未返信レビュー 全${meta.counts.total}件`,
    `・ショップレビュー: ${meta.counts.shop}件`,
    `・商品レビュー: ${meta.counts.item}件`,
    `・⚠要確認（低評価など・そのまま貼らない）: ${meta.counts.needsHuman}件`,
    '',
    '添付エクセルの「はじめに」シートに手順があります。',
    'H列の返信文をコピーして、RMSのレビューチェックツールに貼り付けるだけです。',
    '赤い行（要確認）だけは、投稿前に社員へ確認をお願いします。',
    '対応したら J列に「済」を入れてください。',
    '[/info]',
  ].join('\n');

  await uploadChatworkFile({
    buffer: xlsx,
    fileName: `レビュー返信パック_${meta.from.replace(/\//g, '')}-${meta.to.replace(/\//g, '')}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    message,
    roomId,
  });
  console.log(`送信しました（ルームID: ${roomId} / ${meta.counts.total}件）`);
}

if (process.argv[1] && process.argv[1].endsWith('sendReplyPack.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
