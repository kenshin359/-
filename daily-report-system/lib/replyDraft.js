// ============================================================
//  楽天レビューへの返信下書きの組み立て
// ------------------------------------------------------------
//  AI が書くのは「そのお客様だけに向けた部分」だけで、
//  挨拶・結びは config/reply-blocks.json の固定文を使います。
//
//  この作りにしている理由:
//   ① 文体がぶれない（323件の既存返信と同じ型になる）
//   ② AIが余計な約束をする余地が構造的に無い
//   ③ 渡すデータが小さく、費用がほとんどかからない
//   ④ 文面を変えたいときは設定ファイルを直すだけ
//
//  ★自動投稿はしません。楽天にレビュー返信のAPIは無く、
//    またお客様に向けた文面を無人で出すべきでもないためです。
//    CS担当がRMSの管理画面に貼り付ける前提です。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(__dirname, '..', 'config', 'reply-blocks.json');

export function loadBlocks(file = CONFIG) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * 人の確認が必要かを、AIの判断とは別にコード側でも判定する。
 *
 * ★AIの判定だけに頼らない理由:
 *   星1のレビューを AI が needs_human=false と返す可能性がゼロではない。
 *   安全に関わる見落としは許容できないので、機械的な条件でも二重に見る。
 *
 * @returns {{needed: boolean, reasons: string[]}}
 */
export function checkEscalation(review, cfg) {
  const rule = cfg.escalate ?? {};
  const reasons = [];

  const threshold = rule.star_at_or_below ?? 3;
  if (typeof review.star === 'number' && review.star <= threshold) {
    reasons.push(`★${review.star}（${threshold}以下）`);
  }

  const body = String(review.body ?? '');
  const hit = (rule.keywords ?? []).filter((k) => k && body.includes(k));
  if (hit.length) reasons.push(`注意語: ${hit.join('・')}`);

  return { needed: reasons.length > 0, reasons };
}

/**
 * スーツケース系のレビューかどうかを推定する。
 * 結びの一文を出し分けるために使う。
 */
export function isSuitcaseReview(review, cfg) {
  const words = cfg.suitcase_keywords ?? [];
  const body = String(review?.body ?? '');
  return words.some((w) => w && body.includes(w));
}

/**
 * AIの出力と固定文から、貼り付けられる返信文を組み立てる。
 *
 * @param {object} ai   { body, apology, needs_human, reason, topics }
 * @param {object} review { star, body, ... }
 * @param {object} cfg  loadBlocks の結果
 * @returns {{text: string, needsHuman: boolean, reasons: string[], topics: string[]}}
 */
export function assembleReply(ai, review, cfg) {
  const b = cfg.blocks;
  const esc = checkEscalation(review, cfg);
  // AIの判断とコード側の判断、どちらかが true なら人の確認が要る
  const needsHuman = !!ai?.needs_human || esc.needed;
  const reasons = [...esc.reasons];
  if (ai?.needs_human && ai.reason) reasons.push(ai.reason);

  // 感謝の一文を選ぶ。
  // ★不満が書かれているレビューに「嬉しく思います」と返すと失礼になる。
  //   謝罪が入る場合は「貴重なご意見をお寄せいただき」に切り替える。
  const hasApology = !!(ai?.apology ?? '').trim();
  const isDetailed = String(review.body ?? '').length >= 120;
  const thanks = hasApology
    ? (b.thanks_feedback ?? b.thanks_short)
    : (isDetailed ? b.thanks_detailed : b.thanks_short);

  const parts = [b.greeting, thanks];

  // 結びは商品に合わせて選ぶ。
  // ★「弊社キャリーケースを〜」はスーツケース購入者にしか合わない。
  //   ハンディファンやドライヤーの購入者に使うと噛み合わない文面になる。
  //   判断がつかないときは、無難な general を使う。
  const closingLine = isSuitcaseReview(review, cfg) ? b.closing_suitcase : b.closing_general;

  const body = (ai?.body ?? '').trim();
  if (body) parts.push(body);

  const apology = (ai?.apology ?? '').trim();
  if (apology) parts.push(apology);

  parts.push(b.invite);
  if (closingLine) parts.push(closingLine);
  parts.push(...b.closing);

  return {
    text: parts.filter(Boolean).join('\n'),
    needsHuman,
    reasons,
    topics: Array.isArray(ai?.topics) ? ai.topics.slice(0, 3) : [],
  };
}

/**
 * 組み立てた返信文が、設定に無い約束をしていないか点検する。
 *
 * ★プロンプトで禁止するだけでは足りない。出来上がった文も見る。
 *   金銭や条件の約束は、間違えると実害が出るため。
 *
 * @returns {string[]} 問題があればその説明
 */
export function auditReply(text) {
  const problems = [];

  // 送料負担についての誤り（実際は「部品代は無償／送料はお客様負担」）
  // 「送料のみお客様のご負担」という正しい説明は引っかからないようにしている
  if (/送料\s*(は|が|も|につきまして[はも]?|について[はも]?)?\s*(無料|無償|弊社|当社|こちら(で|が))/.test(text)) {
    problems.push('送料を無料・弊社負担と書いています（実際はお客様のご負担です）');
  }
  // 具体的な補償の約束
  if (/(返金|全額|新品と交換|無償で交換)(いた)?します/.test(text)) {
    problems.push('返金・交換を確約しています（個別判断が必要な内容です）');
  }
  // 守れない断定
  if (/(必ず|絶対に|100%)/.test(text)) {
    problems.push('「必ず」「絶対に」など断定的な表現があります');
  }
  // 納期の約束
  if (/\d+\s*(日|週間|営業日)以内に(お届け|発送|到着)/.test(text)) {
    problems.push('具体的な納期を約束しています');
  }
  // 個人情報らしきもの
  if (/\d{3}-\d{4}-\d{4}|\d{6,}/.test(text)) {
    problems.push('数字の並びがあります（注文番号・電話番号が混ざっていないか確認してください）');
  }

  return problems;
}

/**
 * CS担当（アルバイトを含む）が迷わず作業できる形に整える。
 *
 * 意識していること:
 *  ・1件ごとに「何をすればいいか」を最初に書く（判断を減らす）
 *  ・コピーする範囲を記号で明示する
 *  ・要確認のものは、なぜ確認が必要かを具体的に書く
 *
 * @param {object} item
 * @param {object} opts { index, total }
 */
export function formatForCs(item, opts = {}) {
  const lines = [];
  const no = opts.index && opts.total ? `【${opts.index}/${opts.total}】` : '';
  const action = item.needsHuman
    ? '🔴 そのまま貼らないでください（社員の確認が必要です）'
    : '🟢 そのままコピーして貼ってください';

  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push(`${no} 【${sourceLabel(item.review)}】`);
  lines.push(`★${item.review.star}　${item.review.date}　${item.review.who}`);
  lines.push(action);
  if (item.reasons.length) lines.push(`　確認が必要な理由: ${item.reasons.join(' / ')}`);
  lines.push('');
  lines.push('▼ お客様のレビュー');
  lines.push(item.review.body.slice(0, 300));
  lines.push('');
  lines.push('▼ 返信の下書き（ここから ↓↓↓ ）');
  lines.push('- - - - - - - - - -');
  lines.push(item.text);
  lines.push('- - - - - - - - - -');
  lines.push('（ここまで ↑↑↑ をコピー）');

  if (item.audit?.length) {
    lines.push('');
    lines.push('⚠️ 自動点検で引っかかりました。貼る前に社員へ確認してください:');
    for (const p of item.audit) lines.push(`　・${p}`);
  }
  return lines.join('\n');
}

/**
 * レビューの種類を、貼る場所が分かる言葉にする。
 * ショップレビューと商品レビューは RMS の貼り付け先が違うため、
 * 作業者が迷わないよう1件ごとに明示する。
 */
export function sourceLabel(review) {
  const s = String(review?.source ?? '');
  if (s.startsWith('item')) return '商品レビュー';
  if (s === 'shop') return 'ショップレビュー';
  return 'レビュー';
}

/** 作業手順の見出し（アルバイト向け） */
export function csHeader({ date, total, needHuman, flagged, bySource }) {
  const auto = total - needHuman;
  const breakdown = bySource
    ? Object.entries(bySource).map(([k, v]) => `${k} ${v}件`).join(' / ')
    : '';
  return [
    `📝 楽天レビュー返信（${date}分・全${total}件）`,
    breakdown ? `内訳: ${breakdown}` : '',
    '',
    `🟢 そのまま貼れる: ${auto}件`,
    `🔴 社員の確認が必要: ${needHuman}件`,
    flagged ? `⚠️ 自動点検で指摘あり: ${flagged}件` : '',
    '',
    '【作業手順】',
    '1. RMS →「レビュー・注文サポート」→「レビューチェックツール」を開く',
    '2. 下の順番どおりに、対象のレビューを探す',
    '3. 🟢 は下書きをそのままコピーして貼り、投稿する',
    '4. 🔴 は投稿せず、このグループで社員に声をかける',
    '5. 投稿できたら、このメッセージに 👍 を付ける',
    '',
    '※ 迷ったら投稿しないでください。あとで直すより聞くほうが早いです。',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
