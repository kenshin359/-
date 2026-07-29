// ============================================================
//  [テスト] 通知が届くか確認する
// ------------------------------------------------------------
//  設定されている宛先（LINE / Chatwork / 両方）へテスト送信します。
//  APP_ENV=test の間は実送信されず、本文プレビューだけ出ます（安全）。
//
//  実行:  npm run notify-test
//         npm run notify-test -- "好きなメッセージ"
//         npm run notify-test -- --urgent    … 緊急扱いで送る
// ============================================================
import { notify, describeResults, resolveChannels } from '../lib/notify.js';

const sample = `📊 Libetee 通知テスト

これはテスト送信です。この文面が読めていれば、
通知の設定は正しく完了しています。

【確認事項】
・宛先は合っていますか？
・改行や絵文字は正しく表示されていますか？

詳細はKintoneをご確認ください。`;

async function main() {
  const urgent = process.argv.includes('--urgent');
  const custom = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const text = custom || (urgent ? '🚨 緊急通知テスト\n\nこれは緊急扱いのテスト送信です。' : sample);

  const channels = resolveChannels();
  console.log(`通知先: ${channels.length ? channels.join(' + ') : '（未設定）'}`);
  if (!channels.length) {
    console.error('\n通知先が設定されていません。.env に LINE か Chatwork の設定を入れてください。');
    process.exit(1);
  }

  const { results, anySent } = await notify(text, { urgent });
  console.log(`\n結果: ${describeResults(results)}`);
  if (results.some((r) => r.skipped)) {
    console.log('（APP_ENV=test のため実送信していません。production にすると送信されます）');
  }
  if (!anySent) process.exitCode = 1;
}

main().catch((e) => {
  console.error('通知テスト エラー:', e.message);
  process.exit(1);
});
