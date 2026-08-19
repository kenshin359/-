// ============================================================
//  タスク報告部屋のメッセージ → コマンド解析
// ------------------------------------------------------------
//  スタッフが Chatwork に投稿したメッセージを、決まった書式の
//  コマンドとして解釈します（純関数・テスト可能）。
//
//  対応コマンド（メッセージ1行目で判定）:
//    登録 / タスク登録 / 追加   … 続く箇条書きをタスクとして登録
//    完了 / 終了 / 済 / done    … 続く箇条書きに一致するタスクを完了に
//    着手 / 開始 / start        … 進行中に
//    退勤 / 退社 / あがり        … 残タスクを集計して返信・記録
//  ↑以外は null（通常の会話として無視）。
//
//  例:
//    登録
//    ・提案資料作成（8/15まで）
//    ・見積もり送付
// ============================================================
import { normalizeDue } from './taskExtract.js';

const HEAD = [
  { type: 'register', re: /^(登録|タスク登録|追加|add)[\s:：]*/i },
  { type: 'done', re: /^(完了|終了|済み?|おわり|終わり|done)[\s:：]*/i },
  { type: 'start', re: /^(着手|開始|進行中|start)[\s:：]*/i },
  { type: 'leave', re: /^(退勤|退社|あがり|上がり|お先|おつかれ|お疲れ|leave)[\s:：]*/i },
];

function stripBullet(line) {
  return line.replace(/^[\s・･\-*●○◦▪️0-9.)、]+/, '').trim();
}

// 1行から期限・優先度を取り除いてタイトルに
function parseItemLine(line, todayKey) {
  const raw = stripBullet(line);
  if (!raw) return null;
  let due = null;
  const dm =
    raw.match(/(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/) ||
    raw.match(/(\d{1,2}[\/月]\d{1,2}日?)(?:まで|迄|締切|期限)?/);
  if (dm) due = normalizeDue(dm[1], todayKey);
  const prio = /【?\s*高\s*】?|最優先|至急|緊急/.test(raw) ? '高' : '中';
  const title = raw
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/g, '')
    .replace(/\d{1,2}[\/月]\d{1,2}日?/g, '')
    .replace(/(まで|迄|締切|期限|至急|緊急|最優先)/g, '')
    .replace(/[　\s]+/g, ' ')
    .replace(/^[\s:：・\-]+|[\s:：・\-]+$/g, '')
    .trim();
  if (!title) return null;
  return { title: title.length > 60 ? title.slice(0, 59) + '…' : title, due, prio };
}

/**
 * メッセージ本文をコマンドに解釈する。
 * @param {string} body
 * @param {object} opts { todayKey }
 * @returns {null | {type, items}}  コマンドでなければ null
 */
export function parseCommand(body, opts = {}) {
  const todayKey = opts.todayKey;
  const lines = String(body || '')
    .split(/\r?\n/)
    .map((l) => l.trim());
  const first = lines.find((l) => l.length > 0);
  if (!first) return null;

  const head = HEAD.find((h) => h.re.test(first));
  if (!head) return null;

  // 1行目の見出し語の後ろに本文が続く場合（例:「完了 提案資料」）も拾う
  const inlineRest = first.replace(head.re, '').trim();
  const rest = [];
  if (inlineRest) rest.push(inlineRest);
  const idx = lines.indexOf(first);
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i]) rest.push(lines[i]);
  }

  if (head.type === 'leave') return { type: 'leave', items: [] };

  const items = [];
  for (const line of rest) {
    const it = parseItemLine(line, todayKey);
    if (it) items.push(head.type === 'register' ? it : { title: it.title, due: it.due, prio: it.prio });
  }
  return { type: head.type, items };
}
