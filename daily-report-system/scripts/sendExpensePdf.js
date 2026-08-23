#!/usr/bin/env node
// ============================================================
//  経費レポートPDFをChatworkへ送る
// ------------------------------------------------------------
//  out/expense-report.pdf を、指定した名前のルームに投稿します。
//  ルーム名は部分一致で探します（sendReviewInbox と同じ仕組み）。
//
//  実行: node scripts/sendExpensePdf.js --room=経理
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { uploadChatworkFile } from '../lib/chatwork.js';
import { findRoom, candidateRooms } from './sendReviewInbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, '..'), 'out');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const roomName = arg('room', '経理');
  const roomIdArg = arg('room-id', '');
  const token = required('CHATWORK_API_TOKEN');

  const pdfPath = path.join(OUT, 'expense-report.pdf');
  const jsonPath = path.join(OUT, 'expense-report.json');
  if (!fs.existsSync(pdfPath)) throw new Error(`${pdfPath} がありません。先に集計→PDF作成を実行してください。`);
  const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  let roomId = roomIdArg;
  if (!roomId) {
    const res = await fetchWithRetry('https://api.chatwork.com/v2/rooms', {
      headers: { 'X-ChatWorkToken': token },
    }, { label: 'chatwork rooms' });
    const rooms = res.json ?? [];
    const room = findRoom(rooms, roomName);
    if (!room) {
      const cands = candidateRooms(rooms, roomName).map((r) => `  ・${r.name}`).join('\n');
      throw new Error(`ルーム「${roomName}」が見つかりません。候補:\n${cands || '  （なし）'}`);
    }
    roomId = room.room_id;
    console.log(`ルーム: ${room.name} (${roomId})`);
  }

  const message =
    `[info][title]経費レポート（${meta.period.label}）[/title]` +
    `合計: ${Number(meta.total).toLocaleString()}円 ／ ${meta.count}件\n` +
    `明細はPDFをご確認ください。修正はキントーン「経費管理」アプリへ。[/info]`;

  await uploadChatworkFile({
    buffer: fs.readFileSync(pdfPath),
    fileName: `経費レポート_${meta.period.start}_${meta.period.end}.pdf`,
    contentType: 'application/pdf',
    message,
    roomId,
  });
  console.log('送信しました。');
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(1);
  });
}
