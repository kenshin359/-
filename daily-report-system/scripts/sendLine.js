// ============================================================
//  [APIサンプル] LINE 送信だけを単体で試す
// ------------------------------------------------------------
//  APP_ENV=test の間は送信されず、本文プレビューだけ出ます（安全）。
//  本番送信を試すには .env の APP_ENV=production にしてください。
//
//  実行:  node scripts/sendLine.js "送りたいテキスト"
//         node scripts/sendLine.js            … サンプル文を使用
// ============================================================
import { pushLine } from '../lib/line.js';

const sample = `📊 Libetee 日報（テスト送信）

【結論】🟢 テスト送信です。問題ありません。

【成果】
・LINE 連携の疎通確認

【要対応】
・情報不足

【承認】
・情報不足

【明日の最優先】
・本番運用の開始

詳細はKintoneをご確認ください。`;

async function main() {
  const text = process.argv[2] || sample;
  const r = await pushLine(text);
  if (r.skipped) {
    console.log('\n（APP_ENV=test のため実送信していません。production にすると送信されます）');
  } else {
    console.log(`\n送信完了 ✅  宛先=${r.to} / ${r.requests} リクエスト`);
  }
}

main().catch((e) => {
  console.error('LINE送信エラー:', e.message);
  process.exit(1);
});
