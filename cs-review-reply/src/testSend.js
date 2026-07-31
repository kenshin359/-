// `npm run test-send` … Chatwork へ“実際に”テスト送信するための専用コマンド。
//
// 目的：本番のレビュー取得はまだ検証していないため、まずは Chatwork 連携（接続・
//   ルーム・文面の見た目・4000字分割）を、架空のサンプルレビューで確認します。
//
// ★このコマンドは人が明示的に叩く“テスト”です。各メッセージ先頭に【テスト送信】を付け、
//   sendChatwork に force:true を渡して APP_ENV=test でも送ります（定時ジョブは送りません）。
// ★使うのは架空データだけ。実在のお客様情報は送りません。
import { loadConfig } from "./config.js";
import { say } from "./util/log.js";
import { detectDanger } from "./safety/dangerDetector.js";
import { checkPromises } from "./safety/promiseChecker.js";
import { generateReply } from "./reply/generateReply.js";
import { assembleReply } from "./reply/assembleReply.js";
import { classify } from "./triage/classify.js";
import { formatCs } from "./chatwork/formatCs.js";
import { formatChina } from "./chatwork/formatChina.js";
import { formatSns } from "./chatwork/formatSns.js";
import { sendChatwork } from "./chatwork/client.js";
import { fetchSheetCsv, toRecords } from "./sheets/fetchSheet.js";
import { extractChinaDefects } from "./sheets/chinaDefects.js";

// 架空のサンプルレビュー（実在の顧客データではありません）
const SAMPLE_REVIEWS = [
  {
    kind: "item", productName: "超軽量スーツケース Mサイズ", category: "suitcase", itemId: "10000038",
    rating: 5, date: "2026-07-31", author: "テスト太郎",
    body: "キャスターがとても静かで、深夜の帰宅でも気になりません。出張で毎週使っていますが大満足です。",
  },
  {
    kind: "item", productName: "ハンディファン Pro", category: "fan", itemId: "10000052",
    rating: 2, date: "2026-07-31", author: "テスト花子",
    body: "届いて2日で壊れました。風も弱く、初期不良だと思います。返品したいです。",
  },
  {
    kind: "shop", productName: "ショップレビュー", category: "unknown", itemId: "",
    rating: 3, date: "2026-07-31", author: "テスト次郎",
    body: "外箱が少しへこんでいました。中身は問題なかったです。",
  },
];

const BANNER =
  "【テスト送信】これは自動連携ソフトの動作確認です（架空のサンプルデータ）。実際のお客様レビューではありません。\n\n";

async function main() {
  // needSend:false（このコマンド専用の必須チェックは下で自前に行う）
  const cfg = loadConfig({ needSend: false });

  if (!cfg.chatwork.token) {
    say("エラー: CHATWORK_API_TOKEN が未設定です。cs-review-reply/.env に設定してください。");
    process.exit(1);
  }
  say("▶ テスト送信を開始します（各メッセージ先頭に【テスト送信】を付けます）");
  say(`  送り先 CS   room: ${cfg.chatwork.csRoomId || "(未設定)"}`);
  say(`  送り先 SNS  room: ${cfg.chatwork.snsRoomId || "(未設定)"}`);
  say(`  送り先 中国 room: ${cfg.chatwork.chinaRoomId || "(未設定・スキップ)"}`);

  // パイプラインでサンプルを処理
  const csEntries = [], chinaEntries = [], snsEntries = [];
  for (const r of SAMPLE_REVIEWS) {
    const danger = detectDanger(r, cfg.dangerWords);
    const ai = await generateReply(r, cfg);
    const reply = assembleReply({
      review: r,
      ai: { body: ai.body, needsApology: ai.needs_apology, apology: ai.apology },
      danger,
      blocks: cfg.replyBlocks,
    });
    const promise = checkPromises(reply, cfg.promiseCheck);
    const reasons = [...danger.reasons];
    if (!promise.ok) promise.violations.forEach((v) => reasons.push(`【文面注意】${v}`));
    const needsHuman = danger.needsHuman || !promise.ok;

    csEntries.push({ kind: r.kind, productName: r.productName, rating: r.rating, date: r.date, author: r.author, body: r.body, reply, needsHuman, reasons });

    const route = classify({ review: r, ai, danger });
    if (route.toChina) chinaEntries.push({ productName: r.productName, rating: r.rating, date: r.date, body: r.body, issueCategory: ai.issue_category, issueSummary: ai.issue_summary });
    if (route.toSns) snsEntries.push({ productName: r.productName, rating: r.rating, date: r.date, body: r.body, snsReason: ai.sns_reason });
  }

  const label = "テスト（2026/7/31）";

  // CS
  await sendChatwork(cfg, cfg.chatwork.csRoomId, BANNER + formatCs(csEntries, label), { force: true, label: "CS返信下書き(テスト)" });
  // SNS
  const snsText = formatSns(snsEntries, label);
  if (snsText) await sendChatwork(cfg, cfg.chatwork.snsRoomId, BANNER + snsText, { force: true, label: "SNS共有(テスト)" });
  else say("  SNS: サンプルに該当なし");
  // 中国：スプシの不具合リスト（テストなので日付で絞らず、直近ぶんを最大15件だけ表示）＋レビュー由来
  let sheetDefects = [];
  let sheetMeta = {};
  if (cfg.chinaSheet.url) {
    try {
      const csv = await fetchSheetCsv(cfg.chinaSheet.url);
      const { headers, records } = toRecords(csv);
      const ext = extractChinaDefects(headers, records, cfg.chinaDefects, {}); // sinceDate指定なし＝全件
      // 日付の新しい順に並べ、テスト表示は最大15件に絞る（本番は日付でN日絞り）
      const sorted = ext.defects.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const CAP = 15;
      sheetDefects = sorted.slice(0, CAP);
      sheetMeta = { skippedNoDate: ext.skippedNoDate };
      say(`  スプシ不具合: 抽出${ext.defects.length}件中 先頭${sheetDefects.length}件をテスト表示`);
    } catch (e) {
      say("  スプシ取得に失敗: " + e.message);
    }
  } else {
    say("  スプシ未設定（CHINA_SHEET_URL）");
  }

  const chinaText = formatChina({ sheetDefects, reviewComplaints: chinaEntries }, label, sheetMeta);
  if (chinaText && cfg.chatwork.chinaRoomId) {
    await sendChatwork(cfg, cfg.chatwork.chinaRoomId, BANNER + chinaText, { force: true, label: "中国チーム報告(テスト)" });
  } else if (chinaText) {
    say("  中国チーム: ルーム未設定のため送信スキップ。以下が生成される報告です（確認用）:");
    console.log("\n---------------- 中国チーム報告(プレビュー) ----------------\n" + chinaText + "\n----------------------------------------------------------\n");
  } else {
    say("  中国チーム: 対象なし");
  }

  say("完了。Chatwork の各ルームをご確認ください。");
}

main().catch((err) => {
  say("エラーで停止しました: " + err.message);
  process.exit(1);
});
