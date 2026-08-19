// ============================================================
//  タスク報告部屋の状態ストア＋コマンド適用
// ------------------------------------------------------------
//  スタッフの「登録／完了／着手／退勤」コマンドを、タスク一覧に
//  反映します。ページ再訪でも残るよう state/ に保存します。
//
//  ・applyCommand()      … 1メッセージ分のコマンドをストアに適用（純関数）
//  ・storeTasksToCalendar() … ストア → カレンダー用タスク
//  ・load/save は IO（scripts から使用）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { teamForName } from './taskData.js';
import { inferCategory } from './chatworkTasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORE_PATH = path.join(__dirname, '..', 'state', 'report-tasks.json');

export function emptyStore() {
  return { tasks: [], processed: [], snapshots: [] };
}
export function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return { tasks: s.tasks || [], processed: s.processed || [], snapshots: s.snapshots || [] };
  } catch {
    return emptyStore();
  }
}
export function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store), 'utf8');
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h.toString(36);
}
const norm = (s) => String(s || '').replace(/[\s　・,、。.:：]/g, '').toLowerCase();

function statusForDue(due, todayKey) {
  return todayKey && due < todayKey ? 'late' : 'todo';
}

/**
 * 1件のコマンドをストアへ適用する（store を直接更新）。
 * @param {object} store   loadStore() の結果
 * @param {object} ctx     { sender, messageId, dateKey, command, todayKey }
 * @returns {{changed:boolean, reply:(string|null), kind:string}}
 */
export function applyCommand(store, ctx) {
  const { sender, messageId, dateKey, command, todayKey } = ctx;
  const key = String(messageId);
  if (messageId != null && store.processed.includes(key)) {
    return { changed: false, reply: null, kind: 'skip' };
  }
  let result = { changed: false, reply: null, kind: command ? command.type : 'none' };

  if (command && command.type === 'register') {
    const added = [];
    command.items.forEach((it, i) => {
      const due = it.due || todayKey;
      const task = {
        id: 'rp' + hash(`${sender}|${it.title}|${dateKey}`) + '-' + i,
        memberName: sender,
        title: it.title,
        due,
        prio: it.prio || '中',
        status: statusForDue(due, todayKey),
        createdAt: dateKey,
        doneAt: null,
        room: ctx.room || null,
      };
      store.tasks.push(task);
      added.push(task);
    });
    result.changed = added.length > 0;
    result.reply = added.length
      ? `登録しました（${added.length}件）\n` + added.map((t) => `・${t.title}（期日 ${t.due}）`).join('\n')
      : '登録するタスクが読み取れませんでした。「登録」の次の行に「・タスク名」の形で書いてください。';
  } else if (command && (command.type === 'done' || command.type === 'start')) {
    const open = store.tasks.filter((t) => t.memberName === sender && t.status !== 'done');
    const matched = [];
    const notFound = [];
    for (const it of command.items) {
      const t = open.find((x) => norm(x.title).includes(norm(it.title)) || norm(it.title).includes(norm(x.title)));
      if (t && !matched.includes(t)) {
        if (command.type === 'done') { t.status = 'done'; t.doneAt = dateKey; }
        else t.status = 'doing';
        matched.push(t);
      } else if (!t) notFound.push(it.title);
    }
    result.changed = matched.length > 0;
    const verb = command.type === 'done' ? '完了' : '着手';
    let msg = matched.length ? `${verb}にしました（${matched.length}件）\n` + matched.map((t) => `・${t.title}`).join('\n') : `${verb}できるタスクが見つかりませんでした。`;
    if (notFound.length) msg += `\n（未一致: ${notFound.join(' / ')}）`;
    result.reply = msg;
  } else if (command && command.type === 'leave') {
    const remaining = store.tasks.filter((t) => t.memberName === sender && t.status !== 'done');
    store.snapshots.push({ memberName: sender, date: dateKey, remaining: remaining.map((t) => t.title), at: dateKey });
    result.changed = true;
    result.kind = 'leave';
    if (remaining.length === 0) {
      result.reply = 'お疲れさまでした！本日の残タスクはありません。🎉';
    } else {
      const late = remaining.filter((t) => t.status === 'late');
      result.reply =
        `お疲れさまでした。本日時点の残タスク ${remaining.length}件` +
        (late.length ? `（うち遅延 ${late.length}件）` : '') +
        `\n` +
        remaining.map((t) => `${t.status === 'late' ? '⚠ ' : '・'}${t.title}（期日 ${t.due}）`).join('\n');
    }
  }

  if (messageId != null) store.processed.push(key);
  return result;
}

/** ストアのタスク → カレンダー用タスク（期日超過の未完了は遅延に再判定） */
export function storeTasksToCalendar(store, opts = {}) {
  const todayKey = opts.todayKey;
  return (store.tasks || []).map((t) => {
    let status = t.status;
    if (status !== 'done' && todayKey && t.due < todayKey) status = 'late';
    const [y, mo, d] = t.due.split('-').map(Number);
    return {
      id: t.id,
      title: t.title,
      cat: inferCategory(t.title),
      dept: teamForName(t.memberName),
      member: 'rp:' + t.memberName,
      memberName: t.memberName,
      status,
      prio: t.prio || '中',
      y,
      mo: mo - 1,
      d,
      key: t.due,
      source: 'chatwork-report',
    };
  });
}
