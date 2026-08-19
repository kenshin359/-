#!/usr/bin/env node
// ============================================================
//  売上進捗シート（Excel）を朝礼ルーム（みさきさん）へ送付
// ------------------------------------------------------------
//  実行: node scripts/sendChoreiSheet.js [--dry-run]
//  ※ 先に choreiSheetData.js → buildChoreiSheet.py を実行しておくこと
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optional } from '../lib/env.js';
import { uploadChatworkFile } from '../lib/chatwork.js';
import { todayISO } from '../lib/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHEET = path.join(ROOT, 'out', '売上進捗シート.xlsx');
const isDry = process.argv.includes('--dry-run');

async function main() {
  if (!fs.existsSync(SHEET)) throw new Error('out/売上進捗シート.xlsx がありません（先にビルドしてください）');
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'chorei-progress.json'), 'utf8'));
  const mtd = Object.values(data.days).reduce((s, d) => s + d.rakuten + d.amazon + d.own, 0);
  const dateISO = todayISO();
  const message = [
    '[info][title]📊 売上進捗シート（イベント加重・自動生成）[/title]',
    `${data.upTo.slice(5).replace('-', '/')}実績まで反映済みです。`,
    `・実績累計: ¥${mtd.toLocaleString()}`,
    '・「目標乖離」シートに1.1億/1.2億の日別目標との差を全日記載',
    '・イベント日程（青字）は変更するとシート内が自動で再計算されます',
    '[/info]',
  ].join('\n');
  if (isDry) { console.log(message); console.log('（--dry-run のため送信しません）'); return; }
  const roomId = optional('CHATWORK_CHOREI_ROOM_ID') || '433161347';
  const fileName = `売上進捗シート_${dateISO.replaceAll('-', '')}.xlsx`;
  await uploadChatworkFile({
    buffer: fs.readFileSync(SHEET),
    fileName,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    message,
    roomId,
  });
  console.log(`✅ ${fileName} をルーム ${roomId} に送付しました`);
}

main().catch((e) => { console.error('エラー:', e.message); process.exit(1); });
