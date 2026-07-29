// ============================================================
//  楽天レビューへの返信下書きを作る（CS担当がコピペする用）
// ------------------------------------------------------------
//  まだ返信していないレビューを拾い、1件ずつ下書きを作って
//  Chatwork に送ります。CS担当はRMSの管理画面に貼り付けるだけです。
//
//  実行:
//    npm run replies                  … 未返信のレビューぶん
//    npm run replies -- --pages=3     … 取得ページ数（1ページ30件）
//    npm run replies -- --limit=10    … 下書きを作る件数の上限
//    npm run replies -- --dry-run     … 送らずに画面に表示
//    npm run replies -- --init        … 既存レビューを「処理済み」にする（初回）
//
//  ★自動投稿はしません。楽天にレビュー返信APIが無いこともありますが、
//    それ以上に、お客様への文面を人が見ないまま出すべきではないためです。
//
//  ★★星3以下、および安全・不良・返金に触れるレビューは
//    「要確認」を必ず付けます。そのまま貼らないでください。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchShopReviews,
  fetchItemReviews,
  configuredItemIds,
  reviewKey,
} from '../lib/rakutenReviews.js';
import { loadBlocks, assembleReply, auditReply, formatForCs, csHeader } from '../lib/replyDraft.js';
import { callClaudeRaw, parseJsonFromModel } from '../lib/claude.js';
import { notify, describeResults, resolveChannels } from '../lib/notify.js';
import { pushChatwork } from '../lib/chatwork.js';
import { required, optional } from '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, 'state', 'replied-reviews.json');
const PROMPT = path.join(ROOT, 'prompts', 'review-reply-prompt.md');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function loadState() {
  if (!fs.existsSync(STATE)) return { handled: [] };
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return { handled: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  // 無限に増えないよう直近2000件だけ保持する
  state.handled = state.handled.slice(-2000);
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1), 'utf8');
}

async function main() {
  const pages = Number(arg('pages', '2'));
  const limit = Number(arg('limit', '10'));
  const isDry = process.argv.includes('--dry-run');
  const isInit = process.argv.includes('--init');
  // 何日ぶんのレビューを対象にするか（既定1日＝当日と前日ぶん）
  const days = Number(arg('days', '1'));

  console.log('楽天のレビューを取得します…');

  const reviews = [];
  reviews.push(...(await fetchShopReviews(pages)));
  for (const id of configuredItemIds()) {
    reviews.push(...(await fetchItemReviews(id, pages)));
  }
  console.log(`  取得: ${reviews.length}件`);

  const state = loadState();
  const handled = new Set(state.handled);

  // 対象の期間を決める（楽天の日付は 2026/07/29 形式）
  const since = new Date();
  since.setDate(since.getDate() - days);
  const inPeriod = (r) => {
    const m = String(r.date).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) return true; // 日付が読めないものは落とさない
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) >= since;
  };

  // まだ返信しておらず、こちらでも下書きを作っていないもの
  const targets = reviews
    .filter((r) => !r.shopReply && !handled.has(reviewKey(r)))
    .filter(inPeriod);
  console.log(`  ショップ返信済み: ${reviews.filter((r) => r.shopReply).length}件`);
  console.log(`  下書きが必要: ${targets.length}件`);

  if (isInit) {
    for (const r of reviews) handled.add(reviewKey(r));
    saveState({ handled: [...handled] });
    console.log(`✅ 既存の${reviews.length}件を処理済みにしました。次回から新着分だけ下書きします。`);
    return;
  }

  if (!targets.length) {
    console.log('新しく下書きが必要なレビューはありません。');
    return;
  }

  required('ANTHROPIC_API_KEY');
  const cfg = loadBlocks();
  const system = fs.readFileSync(PROMPT, 'utf8');

  const batch = targets.slice(0, limit);
  if (targets.length > batch.length) {
    console.log(`  ※ 今回は${batch.length}件だけ作ります（--limit で変更できます）`);
  }

  const drafts = [];
  for (const review of batch) {
    try {
      const raw = await callClaudeRaw({
        system,
        userText:
          '### 文体の見本（この言い回しに寄せてください）\n```json\n' +
          JSON.stringify(cfg.style_examples ?? [], null, 2) +
          '\n```\n\n### 事実（ここに無いことは書かないでください）\n```json\n' +
          JSON.stringify(cfg.facts, null, 2) +
          '\n```\n\n### お客様のレビュー\n' +
          `星: ${review.star}\n投稿日: ${review.date}\n本文:\n${review.body}\n`,
        maxTokens: 700,
      });
      const ai = parseJsonFromModel(raw);
      const built = assembleReply(ai, review, cfg);
      drafts.push({ review, ...built, audit: auditReply(built.text) });
      console.log(`  ${built.needsHuman ? '⚠️' : '✅'} ★${review.star} ${review.date} ${review.who}`);
    } catch (e) {
      console.warn(`  ❌ ★${review.star} ${review.who} の下書きに失敗: ${e.message}`);
    }
  }

  if (!drafts.length) {
    console.log('下書きを1件も作れませんでした。');
    return;
  }

  const needHuman = drafts.filter((d) => d.needsHuman);
  const flagged = drafts.filter((d) => d.audit.length);

  const header = csHeader({
    date: new Date().toLocaleDateString('ja-JP'),
    total: drafts.length,
    needHuman: needHuman.length,
    flagged: flagged.length,
  });

  const bodies = drafts
    .map((d, i) => formatForCs(d, { index: i + 1, total: drafts.length }))
    .join('\n\n');

  if (isDry) {
    console.log('\n--- [dry-run] 送信内容 ---\n' + header + '\n\n' + bodies);
    return;
  }

  // CS専用グループが設定されていれば、そちらだけに送る（経営向けの通知と混ぜない）
  const csRoom = optional('CHATWORK_CS_ROOM_ID');
  let anySent = false;
  if (csRoom) {
    console.log(`\n通知先: Chatwork CS専用グループ (${csRoom})`);
    const r = await pushChatwork(header + '\n\n' + bodies, { roomId: csRoom, decorate: false });
    anySent = !r.skipped;
    console.log(r.skipped ? 'テストモードのため未送信' : `送信成功（${r.parts}通）`);
  } else {
    console.log(`\n通知先: ${resolveChannels().join(' + ') || '（未設定）'}`);
    console.log('  ※ CHATWORK_CS_ROOM_ID を設定すると、CS専用グループだけに送れます。');
    const res = await notify(header + '\n\n' + bodies);
    anySent = res.anySent;
    console.log(describeResults(res.results));
  }

  // 送信できたものだけ処理済みにする（失敗したら次回また作る）
  if (anySent) {
    for (const d of drafts) handled.add(reviewKey(d.review));
    saveState({ handled: [...handled] });
  }
}

main().catch((e) => {
  console.error('下書き作成エラー:', e.message);
  process.exit(1);
});
