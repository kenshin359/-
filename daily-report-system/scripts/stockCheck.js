#!/usr/bin/env node
// ============================================================
//  在庫の確認と通知
// ------------------------------------------------------------
//  「在庫管理」アプリを見て、欠品・残りわずか・補充が必要な商品を
//  Chatwork に知らせます。
//
//  実行:
//    npm run stock:check                   … 今日ぶんを画面に表示
//    npm run stock:check -- --send         … Chatwork にも送る
//    npm run stock:check -- --date=2026-07-31
//    npm run stock:check -- --low=20       … 「残りわずか」の基準（既定10個）
//
//  ★kintone は読むだけです。
// ============================================================
import { findSnapshot, findPrevious, analyzeStock, formatStockReport, inventoryAppId } from '../lib/stock.js';
import { todayISO } from '../lib/date.js';
import { pushChatwork } from '../lib/chatwork.js';
import { optional } from '../lib/env.js';

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const app = inventoryAppId();
  const date = arg('date') || todayISO();
  const low = Number(arg('low') ?? 10);

  const record = await findSnapshot(date, app);
  if (!record) {
    console.log(`${date} の在庫がまだ入力されていません。`);
    console.log('  kintone「在庫管理」で新規レコードを作り、');
    console.log('  在庫ファイルを添付して明細を入力してください。');
    process.exitCode = 1;
    return;
  }

  const prev = await findPrevious(date, app);
  const a = analyzeStock(record, prev, { low });
  const text = formatStockReport(a, { title: '在庫レポート' });
  console.log(text);

  if (process.argv.includes('--send')) {
    const roomId =
      optional('CHATWORK_STOCK_ROOM_ID') ||
      optional('CHATWORK_SALES_ROOM_ID') ||
      optional('CHATWORK_ROOM_ID');
    if (!roomId) throw new Error('送信先のルームIDが未設定です（CHATWORK_STOCK_ROOM_ID など）');
    const r = await pushChatwork(text, { roomId, title: `在庫レポート ${date}` });
    console.log(r.skipped ? '\n（APP_ENV=test のため送信していません）' : `\n✅ 送信しました（ルーム ${roomId}）`);
  }

  // 欠品があるときは終了コード1（自動実行で気づけるように）
  if (a.out.length || a.needCsRestock.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('stockCheck.js')) {
  main().catch((e) => {
    console.error('エラー:', e.body || e.message);
    process.exit(2);
  });
}
