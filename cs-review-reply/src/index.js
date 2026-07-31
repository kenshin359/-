// エントリポイント：`npm run replies`
// 毎朝の流れ（1.）：
//   1) 楽天のショップレビュー＋商品レビューを取得
//   2) まだ返信していない新着だけを選ぶ
//   3) 1件ずつ返信の下書きを作る（③④はAI、②⑥はコード）
//   4) コピペできる形式にして Chatwork のCSグループへ
//   5) 送ったものを記録し、翌朝に同じレビューを二度送らない
// 追加：
//   ・クレーム/低評価 → 制作の中国チームへ日次報告
//   ・好評/SNS向き   → SNSチームへ共有
//
// ★安全（2.）：自動投稿はしない。危険判定はコード側で独立に行う。test/--dry-run では送らない。

import { loadConfig } from "./config.js";
import { parseArgs } from "./cli.js";
import { setQuiet, say, info, warn } from "./util/log.js";
import { fetchHtml } from "./rakuten/fetch.js";
import { parseReviews } from "./rakuten/parseReviews.js";
import { detectDanger } from "./safety/dangerDetector.js";
import { checkPromises } from "./safety/promiseChecker.js";
import { generateReply } from "./reply/generateReply.js";
import { assembleReply } from "./reply/assembleReply.js";
import { classify } from "./triage/classify.js";
import { loadReplied, isReplied, markReplied } from "./state/repliedStore.js";
import { formatCs } from "./chatwork/formatCs.js";
import { formatChina } from "./chatwork/formatChina.js";
import { formatSns } from "./chatwork/formatSns.js";
import { sendChatwork } from "./chatwork/client.js";
import { fetchSheetCsv, toRecords } from "./sheets/fetchSheet.js";
import { extractChinaDefects } from "./sheets/chinaDefects.js";

// 何日ぶんを対象にするかの下限日付（YYYY-MM-DD文字列で比較）
function cutoffDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayLabel() {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// ショップレビューURL（5-2）
function shopReviewUrl(shopId, page) {
  return `https://review.rakuten.co.jp/shop/4/${shopId}_${shopId}/${page}.1/`;
}
// 商品レビューURL（5-2）
function itemReviewUrl(shopId, reviewItemId, page) {
  return `https://review.rakuten.co.jp/item/1/${shopId}_${reviewItemId}/${page}.1/`;
}

// レビュー取得（1ページ目のみ。新着は先頭に出るため、日次運用では十分）
async function collectReviews(cfg) {
  const shopId = cfg.rakuten.shopId;
  const all = [];

  // ショップレビュー
  try {
    const html = await fetchHtml(shopReviewUrl(shopId, 1));
    const list = parseReviews(html, { kind: "shop" });
    info(`  ショップレビュー: ${list.length}件 取得`);
    for (const r of list) all.push({ ...r, productName: "ショップレビュー", category: "unknown", itemId: "" });
  } catch (e) {
    warn("  ショップレビューの取得に失敗: " + e.message);
  }

  // 商品レビュー（設定された商品ぶん）
  for (const it of cfg.items.items || []) {
    if (!it.reviewItemId) continue;
    try {
      const html = await fetchHtml(itemReviewUrl(shopId, it.reviewItemId, 1));
      const list = parseReviews(html, { kind: "item", productTitle: it.name });
      info(`  商品レビュー[${it.name}]: ${list.length}件 取得`);
      for (const r of list)
        all.push({ ...r, productName: it.name, category: it.category || "unknown", itemId: it.reviewItemId });
    } catch (e) {
      warn(`  商品レビュー[${it.name}]の取得に失敗: ` + e.message);
    }
  }
  return all;
}

async function main() {
  const opts = parseArgs();
  setQuiet(opts.quiet);

  // --dry-run / --init のときは送らないので Chatwork 必須チェックを緩める
  const needSend = !opts.dryRun && !opts.init;
  const cfg = loadConfig({ needSend });

  say(`▶ 楽天レビュー返信 開始（モード: ${cfg.isTest ? "test(送信しない)" : "production"}${opts.dryRun ? " +dry-run" : ""}${opts.init ? " +init" : ""}）`);

  const repliedSet = loadReplied();

  // 1) 取得
  say("① レビューを取得します（楽天へは1.5秒以上あけてアクセス）");
  let reviews = await collectReviews(cfg);

  // 2) 新着だけ＆日付で絞る
  const cutoff = cutoffDate(opts.days);
  reviews = reviews.filter((r) => {
    if (isReplied(repliedSet, r)) return false; // 既に処理済み
    if (r.date && r.date < cutoff) return false; // 対象期間外
    return true;
  });
  say(`② 新着（未処理・直近${opts.days}日）: ${reviews.length}件`);

  // --init：既存を「処理済み」にするだけ（下書きは作らない・送らない）
  if (opts.init) {
    markReplied(repliedSet, reviews);
    say(`③ --init：${reviews.length}件を処理済みとして記録しました（送信はしていません）`);
    say("   ※ この記録（state/replied-reviews.json）は必ずコミットしてください（5-5）。");
    return;
  }

  // 上限
  if (reviews.length > opts.limit) {
    say(`   上限 --limit=${opts.limit} により ${opts.limit}件に絞ります`);
    reviews = reviews.slice(0, opts.limit);
  }

  if (reviews.length === 0) {
    say("新着はありませんでした。終了します。");
    return;
  }

  // 3) 1件ずつ下書き作成＋安全判定＋分類
  say("③ 下書きを作成します（③④はAI、②⑥はコード側で決定）");
  const csEntries = [];
  const chinaEntries = [];
  const snsEntries = [];
  const processed = []; // 記録対象（送れたものだけを後で記録）

  for (const r of reviews) {
    // ★安全判定はコード側で独立に（AIの返事に依存しない）
    const danger = detectDanger(r, cfg.dangerWords);

    // AIに③④＋参考情報を書かせる
    const ai = await generateReply(r, cfg);

    // 6ブロックを組み立て
    const reply = assembleReply({
      review: r,
      ai: {
        body: ai.body,
        needsApology: ai.needs_apology,
        apology: ai.apology,
      },
      danger,
      blocks: cfg.replyBlocks,
    });

    // ★文面の約束チェック（送料無料等）。引っかかったら送らず人へ回す。
    const promise = checkPromises(reply, cfg.promiseCheck);

    const reasons = [...danger.reasons];
    if (!promise.ok) {
      for (const v of promise.violations) reasons.push(`【文面注意】${v}`);
    }
    if (ai._aiError) reasons.push("AI生成に失敗しひな形を使用（内容を必ず確認）");

    const needsHuman = danger.needsHuman || !promise.ok;

    csEntries.push({
      kind: r.kind,
      productName: r.productName,
      rating: r.rating,
      date: r.date,
      author: r.author,
      body: r.body,
      reply,
      needsHuman,
      reasons,
    });

    // 分類（中国チーム／SNS）
    const route = classify({ review: r, ai, danger });
    if (route.toChina) {
      chinaEntries.push({
        productName: r.productName,
        rating: r.rating,
        date: r.date,
        body: r.body,
        issueCategory: ai.issue_category,
        issueSummary: ai.issue_summary,
      });
    }
    if (route.toSns) {
      snsEntries.push({
        productName: r.productName,
        rating: r.rating,
        date: r.date,
        body: r.body,
        snsReason: ai.sns_reason,
      });
    }

    processed.push(r);
  }

  const dateLabel = todayLabel();
  const dry = opts.dryRun;

  // 4) CSグループへ
  say(`④ Chatwork送信（CS: ${csEntries.length}件 / 中国チーム: ${chinaEntries.length}件 / SNS: ${snsEntries.length}件）`);
  const csText = formatCs(csEntries, dateLabel);
  await sendChatwork(cfg, cfg.chatwork.csRoomId, csText, { dryRun: dry, label: "CS返信下書き" });

  // 中国（制作）チームへ日次報告
  //   ①スプシ（CS問い合わせ管理表）の不具合リスト（主）＋②レビュー由来の低評価（補足）を1通で。
  let sheetDefects = [];
  let sheetMeta = {};
  if (cfg.chinaSheet.url) {
    try {
      const csv = await fetchSheetCsv(cfg.chinaSheet.url);
      const { headers, records } = toRecords(csv);
      const ext = extractChinaDefects(headers, records, cfg.chinaDefects, { sinceDate: cutoff });
      sheetDefects = ext.defects;
      sheetMeta = { skippedNoDate: ext.skippedNoDate };
      info(`  スプシ不具合: ${sheetDefects.length}件（直近${opts.days}日）`);
    } catch (e) {
      warn("  スプシの不具合リスト取得に失敗: " + e.message);
    }
  } else {
    info("  スプシ未設定（CHINA_SHEET_URL）。レビュー由来のみで報告します。");
  }

  const chinaText = formatChina(
    { sheetDefects, reviewComplaints: chinaEntries },
    dateLabel,
    sheetMeta
  );
  if (chinaText) {
    await sendChatwork(cfg, cfg.chatwork.chinaRoomId, chinaText, { dryRun: dry, label: "中国チーム日次報告" });
  } else {
    say("  中国チーム報告: 対象なし");
  }

  // SNSチームへ共有
  const snsText = formatSns(snsEntries, dateLabel);
  if (snsText) {
    await sendChatwork(cfg, cfg.chatwork.snsRoomId, snsText, { dryRun: dry, label: "SNS共有" });
  } else {
    say("  SNS共有: 対象なし");
  }

  // 5) 記録（★実際に送った本番のときだけ記録する。test/dry-run では記録しない＝翌日も確認できる）
  if (!cfg.isTest && !dry) {
    markReplied(repliedSet, processed);
    say(`⑤ ${processed.length}件を処理済みとして記録しました。`);
    say("   ※ state/replied-reviews.json を必ずコミットしてください（5-5）。していないと毎朝重複します。");
  } else {
    say("⑤ test/dry-run のため記録はしていません（本番運用時のみ記録します）。");
  }

  say("完了。");
}

main().catch((err) => {
  // ★私が読んで次に何をすればいいか分かる日本語で（10.）
  warn("エラーで停止しました: " + err.message);
  process.exit(1);
});
