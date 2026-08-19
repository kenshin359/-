// ============================================================
//  Chatwork のタスクを取得して、カレンダー用タスクに変換する
// ------------------------------------------------------------
//  各ルームの「タスク」機能（担当者・期限・未完了/完了）を集めて、
//  カレンダー可視化ツールが読む形（lib/taskData.js のタスク）に変換します。
//
//  Chatwork API:
//    GET /rooms                        … 参加ルーム一覧
//    GET /rooms/{room_id}/tasks?status … タスク一覧（open / done）
//
//  ※ Chatwork は読むだけ。タスクの内容は変更しません。
// ============================================================
import { required } from './env.js';
import { fetchWithRetry } from './httpRetry.js';
import { teamForName } from './taskData.js';

const API_BASE = 'https://api.chatwork.com/v2';

function headers() {
  return { 'X-ChatWorkToken': required('CHATWORK_API_TOKEN') };
}

/** 参加している全ルームを取得（[{room_id, name, ...}]） */
export async function fetchRooms() {
  const res = await fetchWithRetry(`${API_BASE}/rooms`, { headers: headers() }, { label: 'chatwork rooms' });
  return Array.isArray(res.json) ? res.json : [];
}

/** 1ルームのタスクを取得（status は 'open' / 'done'） */
export async function fetchRoomTasks(roomId, statuses = ['open', 'done']) {
  const out = [];
  for (const status of statuses) {
    const res = await fetchWithRetry(
      `${API_BASE}/rooms/${encodeURIComponent(roomId)}/tasks?status=${status}`,
      { headers: headers() },
      { label: `chatwork tasks ${roomId} ${status}` }
    );
    if (Array.isArray(res.json)) out.push(...res.json.map((t) => ({ ...t, _room: roomId })));
  }
  return out;
}

// 本文のキーワードから種別を推定（Chatworkタスクには種別が無いため）
const CAT_RULES = [
  [/会議|MTG|ミーティング|朝礼|定例|打合|打ち合わせ|キックオフ/i, 'meeting'],
  [/返信|問い合わせ|問合せ|クレーム|カスタマー|CS対応|電話|メール対応|顧客/i, 'cs'],
  [/出荷|在庫|棚卸|入荷|検品|梱包|配送|発送|物流/i, 'ship'],
  [/分析|レポート|集計|調査|KPI|効果測定|数値/i, 'analyze'],
  [/実装|バグ|デプロイ|コード|API|LP改修|開発|システム|不具合/i, 'dev'],
  [/レビュー|校正|確認|承認|チェック|添削/i, 'review'],
];
export function inferCategory(body) {
  for (const [re, cat] of CAT_RULES) if (re.test(body)) return cat;
  return 'doc';
}

// unix秒 → 'YYYY-MM-DD'（ローカル）
function unixToKey(sec) {
  const d = new Date(Number(sec) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Chatworkタスク1件 → カレンダー用タスク。本文が空なら null。
 * @param {object} ct   Chatwork のタスクオブジェクト
 * @param {object} opts { todayKey:'YYYY-MM-DD' }  期限なしタスクの既定日／遅延判定に使用
 */
export function chatworkTaskToTask(ct, opts = {}) {
  const todayKey = opts.todayKey;
  const body = String(ct.body || '').trim();
  if (!body) return null;

  // 1行目をタスク名に（長すぎる場合は丸める）
  const firstLine = body.split(/\r?\n/)[0].trim();
  const title = firstLine.length > 60 ? firstLine.slice(0, 59) + '…' : firstLine;

  const name = (ct.account && ct.account.name) || '担当未定';
  const team = teamForName(name);

  // 期限：Chatworkの limit_time（unix秒）。無ければ当日扱いにして見えるようにする。
  const hasLimit = ct.limit_time && Number(ct.limit_time) > 0;
  const dueKey = hasLimit ? unixToKey(ct.limit_time) : (todayKey || unixToKey(Date.now() / 1000));

  // ステータス：done→完了 / open かつ期限超過→遅延 / それ以外→未着手
  let status;
  if (ct.status === 'done') status = 'done';
  else if (todayKey && dueKey < todayKey) status = 'late';
  else status = 'todo';

  const prio = /【?\s*高\s*】?|緊急|至急|【?最優先】?/.test(body) ? '高' : '中';

  const [y, mo, d] = dueKey.split('-').map(Number);
  return {
    id: 'cw' + (ct.task_id != null ? ct.task_id : `${team}-${title}`),
    title,
    cat: inferCategory(body),
    dept: team,
    member: 'cw:' + name,
    memberName: name,
    status,
    prio,
    y,
    mo: mo - 1,
    d,
    key: dueKey,
    source: 'chatwork',
    room: ct._room,
  };
}

/** Chatworkタスク配列 → カレンダー用タスク配列（重複task_idは除外） */
export function chatworkTasksToTasks(chatworkTasks, opts = {}) {
  const seen = new Set();
  const out = [];
  for (const ct of chatworkTasks) {
    const t = chatworkTaskToTask(ct, opts);
    if (!t) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}
