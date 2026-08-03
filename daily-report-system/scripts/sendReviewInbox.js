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
import { required, optional } from '../lib/env.js';
import { uploadChatworkFile, pushChatwork } from '../lib/chatwork.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, '..'), 'out');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** 表記ゆれを吸収する（全半角・スペース・かざり文字を無視） */
export function normalizeRoomName(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[【】\[\]（）()『』「」☆★・|｜~〜!！?？]/g, '');
}

/** ルーム一覧から名前で探す（完全一致→正規化一致→片方が含む場合の一意一致） */
export function findRoom(rooms, name) {
  const exact = rooms.find((r) => r.name === name);
  if (exact) return exact;
  const q = normalizeRoomName(name);
  const normEq = rooms.filter((r) => normalizeRoomName(r.name) === q);
  if (normEq.length === 1) return normEq[0];
  const contains = rooms.filter((r) => {
    const n = normalizeRoomName(r.name);
    return n.includes(q) || (q.length >= 3 && n && q.includes(n));
  });
  return contains.length === 1 ? contains[0] : null;
}

/** 見つからないとき、近そうな候補（レビュー/CSを含む名前） */
export function candidateRooms(rooms, name) {
  const keys = ['レビュー', 'review', 'cs', 'カスタマー'];
  return rooms.filter((r) => {
    const n = normalizeRoomName(r.name);
    return keys.some((k) => n.includes(normalizeRoomName(k)));
  });
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
      // 候補のルーム名は公開ログに出さず、いつものChatworkルームへ知らせる
      const cands = candidateRooms(rooms, roomName);
      const fallbackRoom = optional('CHATWORK_SALES_ROOM_ID') || optional('CHATWORK_ROOM_ID');
      if (fallbackRoom) {
        const lines = [
          `[info][title]⚠ レビューPDFを送れませんでした[/title]`,
          `「${roomName}」というルームが見つかりません（このトークンが入っている${rooms.length}ルームの中に無い）。`,
          cands.length
            ? `近そうなルーム:\n${cands.map((r) => `・${r.name}（ID: ${r.room_id}）`).join('\n')}\n上の正しいルーム名（またはID）を教えてください。`
            : 'トークンのアカウントがそのルームに入っているかもご確認ください。',
          '[/info]',
        ].join('\n');
        await pushChatwork(lines, { roomId: fallbackRoom });
        console.log('ルームが見つからないため、既定ルームに候補一覧を送りました');
      }
      throw new Error(
        `「${roomName}」というルームが見つかりません（${rooms.length}ルーム中・候補${cands.length}件はChatworkに送付）。` +
          'ルーム名を確認するか、--room-id=数字 で直接指定してください。'
      );
    }
    roomId = String(hit.room_id);
    console.log(`ルーム（ID: ${roomId}）に送ります`);
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
