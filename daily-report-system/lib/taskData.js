// ============================================================
//  業務タスク：共通ロジック
// ------------------------------------------------------------
//  kintone の「業務タスク」レコードを、カレンダー可視化ツールと
//  Chatwork通知の両方で使える形に変換します。
//  ・チーム / 種別 / ステータス のマスタ（カレンダーHTMLと一致）
//  ・recordToTask()   … kintoneレコード → タスクオブジェクト
//  ・buildDataset()   … タスク配列 → カレンダーが読む {teams,members,tasks}
//  ・buildDigest()    … タスク配列 → チーム別の締切・遅延サマリー
//  ・formatDigest()   … サマリー → Chatwork本文（[info]装飾つき）
//
//  ※ ここには認証もネットワークも含みません（純粋な変換のみ＝テスト可能）。
// ============================================================

// チーム編成（カレンダーHTMLの DEFAULT_TEAMS と一致させること）
export const TEAMS = [
  { id: 'honbu',  name: '本部チーム' },
  { id: 'ad',     name: '広告運用チーム' },
  { id: 'sns',    name: 'SNSチーム' },
  { id: 'lp',     name: 'LPチーム' },
  { id: 'cs',     name: 'CSチーム' },
  { id: 'exec',   name: '社長室' },
  { id: 'tiktok', name: 'TikTok' },
  { id: 'part',   name: 'アルバイト' },
];

// 種別（カレンダーHTMLの CATS と一致）
export const CATEGORIES = [
  { id: 'meeting', name: '会議' },
  { id: 'doc',     name: '資料作成' },
  { id: 'cs',      name: '顧客対応' },
  { id: 'ship',    name: '出荷・物流' },
  { id: 'analyze', name: '分析' },
  { id: 'dev',     name: '開発' },
  { id: 'review',  name: 'レビュー' },
];

// ステータス（カレンダーHTMLの STATUSES と一致）
export const STATUSES = [
  { id: 'todo',  name: '未着手' },
  { id: 'doing', name: '進行中' },
  { id: 'done',  name: '完了' },
  { id: 'late',  name: '遅延' },
];

export const PRIORITIES = ['高', '中', '低'];

// 名簿（カレンダーHTMLの ROSTER と一致）。担当者名からチームを割り当てるのに使う。
// 兼務者（黒葛原＝広告運用＋LP）は先頭を主所属とする。
export const ROSTER = [
  { name: '塚本', teams: ['honbu'] },
  { name: '北野', teams: ['honbu'] },
  { name: '角南', teams: ['ad'] },
  { name: '黒葛原', teams: ['ad', 'lp'] },
  { name: '倉内', teams: ['sns'] },
  { name: '内田', teams: ['sns'] },
  { name: '桝田', teams: ['sns'] },
  { name: 'ミンジ', teams: ['lp'] },
  { name: '三浦', teams: ['lp'] },
  { name: '久保', teams: ['lp'] },
  { name: '笹本', teams: ['cs'] },
  { name: '村田', teams: ['cs'] },
  { name: '関本', teams: ['cs'] },
  { name: '淵田', teams: ['exec'] },
  { name: '西岡', teams: ['exec'] },
  { name: '山本', teams: ['tiktok'] },
  { name: '山近', teams: ['tiktok'] },
  { name: '杉本', teams: ['part'] },
  { name: '辰巳', teams: ['part'] },
  { name: '小西', teams: ['part'] },
  { name: '村方', teams: ['part'] },
  { name: '山下', teams: ['part'] },
];

/**
 * 担当者名から所属チームIDを推定する（Chatworkの表示名は姓＋名などのため部分一致）。
 * 名簿に無ければ 'honbu'（本部チーム）に寄せる。
 */
export function teamForName(name) {
  if (!name) return 'honbu';
  for (const p of ROSTER) {
    if (name.includes(p.name)) return p.teams[0];
  }
  return 'honbu';
}

const teamByName = Object.fromEntries(TEAMS.map((t) => [t.name, t.id]));
const catByName = Object.fromEntries(CATEGORIES.map((c) => [c.name, c.id]));
const statusByName = Object.fromEntries(STATUSES.map((s) => [s.name, s.id]));
const teamNameById = Object.fromEntries(TEAMS.map((t) => [t.id, t.name]));
const statusNameById = Object.fromEntries(STATUSES.map((s) => [s.id, s.name]));

// kintone フィールドコード（createTaskApp.js の定義と一致）
export const FIELD = {
  title: 'task_title',
  assignee: 'assignee',
  team: 'team',
  category: 'category',
  priority: 'priority',
  status: 'status',
  due: 'due_date',
};

function fv(record, code) {
  const f = record[code];
  return f && f.value != null ? f.value : '';
}

// 'YYYY-MM-DD'（kintoneのDATEはこの形）を安全に分解
function splitDate(s) {
  const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]) - 1,
    d: Number(m[3]),
    key: `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`,
  };
}

// 担当者名 → 安定したID（memberの識別に使う）
function memberId(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return 'm' + h.toString(36);
}

/**
 * kintoneレコード1件 → カレンダー用タスク。変換できなければ null。
 */
export function recordToTask(record) {
  const title = fv(record, FIELD.title).trim();
  const dt = splitDate(fv(record, FIELD.due));
  if (!title || !dt) return null;

  const teamName = fv(record, FIELD.team).trim();
  const team = teamByName[teamName] || 'honbu';
  const catName = fv(record, FIELD.category).trim();
  const cat = catByName[catName] || 'doc';
  const statusName = fv(record, FIELD.status).trim();
  const status = statusByName[statusName] || 'todo';
  const prioRaw = fv(record, FIELD.priority).trim();
  const prio = PRIORITIES.includes(prioRaw) ? prioRaw : '中';
  const assignee = fv(record, FIELD.assignee).trim() || '担当未定';
  const id = record.$id ? 'k' + record.$id.value : 'k' + memberId(title + dt.key);

  return {
    id,
    title,
    cat,
    dept: team,
    member: memberId(assignee),
    memberName: assignee,
    status,
    prio,
    y: dt.y,
    mo: dt.mo,
    d: dt.d,
    key: dt.key,
  };
}

/**
 * タスク配列 → カレンダーが読む {generatedAt, teams, members, tasks}
 * @param {Array} tasks  recordToTask で作ったタスク配列
 * @param {string} generatedAt  ISO文字列（呼び出し側で new Date().toISOString()）
 */
export function buildDataset(tasks, generatedAt, source) {
  // メンバー（担当者）を集約。所属チームはタスクから復元（兼務対応）。
  const byMember = new Map();
  for (const t of tasks) {
    let m = byMember.get(t.member);
    if (!m) {
      m = { id: t.member, name: t.memberName, teams: [], dept: t.dept };
      byMember.set(t.member, m);
    }
    if (!m.teams.includes(t.dept)) m.teams.push(t.dept);
  }
  return {
    generatedAt: generatedAt || null,
    source: source || null,
    teams: TEAMS,
    members: [...byMember.values()],
    tasks,
  };
}

/**
 * 締切・遅延のサマリーを作る（Chatwork通知の中身）。
 * @param {Array} tasks
 * @param {object} opts { todayKey: 'YYYY-MM-DD' }  基準日
 * @returns {object} { todayKey, overall, teams:[{id,name,...}] }
 */
export function buildDigest(tasks, opts = {}) {
  const todayKey = opts.todayKey;
  const isOpen = (t) => t.status !== 'done';
  const isOverdue = (t) => isOpen(t) && (t.status === 'late' || (todayKey && t.key < todayKey));
  const isDueToday = (t) => isOpen(t) && todayKey && t.key === todayKey;

  function summarize(list) {
    return {
      total: list.length,
      dueToday: list.filter(isDueToday),
      overdue: list.filter(isOverdue),
      doing: list.filter((t) => t.status === 'doing').length,
      done: list.filter((t) => t.status === 'done').length,
    };
  }

  const teams = TEAMS.map((tm) => {
    const list = tasks.filter((t) => t.dept === tm.id);
    return { id: tm.id, name: tm.name, ...summarize(list) };
  }).filter((t) => t.total > 0);

  return { todayKey, overall: summarize(tasks), teams };
}

function line(t) {
  const p = t.prio === '高' ? '【高】' : '';
  return `・${p}${t.title}（${t.memberName}）[${statusNameById[t.status] || t.status}]`;
}

// チームIDからチーム名（未知なら素のID）
export function teamName(id) {
  return teamNameById[id] || id;
}

/**
 * 前回スナップショットと現在のタスクを比べ、通知すべき変化を洗い出す（純関数）。
 * 定期実行（cron/n8n）で呼び、Webhookなしでも「随時通知」を実現する。
 *
 * @param {object} prev  前回のスナップショット { [taskId]: {status,key,flags:{overdue,stall}} }
 * @param {Array}  tasks 現在のタスク配列
 * @param {object} opts  { todayKey:'YYYY-MM-DD', stallDays?:number }
 * @returns {{events:Array, next:object}}
 *   events: [{type:'start'|'done'|'overdue'|'stall', t, days?}]
 *   next  : 保存する新しいスナップショット
 */
export function diffEvents(prev, tasks, opts = {}) {
  const todayKey = opts.todayKey;
  const stallDays = opts.stallDays == null ? 2 : opts.stallDays;
  const daysUntil = (key) => Math.round((Date.parse(key + 'T00:00:00') - Date.parse(todayKey + 'T00:00:00')) / 86400000);

  const events = [];
  const next = {};

  for (const t of tasks) {
    const p = prev[t.id];
    const prevStatus = p ? p.status : null;
    const prevFlags = (p && p.flags) || {};

    const overdueNow = t.status !== 'done' && (t.key < todayKey || t.status === 'late');
    const stallActive = t.status === 'todo' && !overdueNow && daysUntil(t.key) <= stallDays && t.key >= todayKey;

    // ステータス遷移
    if (t.status === 'doing' && prevStatus !== 'doing') events.push({ type: 'start', t });
    if (t.status === 'done' && prevStatus !== 'done') events.push({ type: 'done', t });

    // 遅延（期限超過 or ステータス遅延）: 立ち上がりだけ通知
    if (overdueNow && !prevFlags.overdue) events.push({ type: 'overdue', t });

    // 停滞（未着手のまま期限が近い）: 立ち上がりだけ通知
    if (stallActive && !prevFlags.stall) events.push({ type: 'stall', t, days: daysUntil(t.key) });

    next[t.id] = {
      status: t.status,
      key: t.key,
      title: t.title,
      memberName: t.memberName,
      dept: t.dept,
      prio: t.prio,
      flags: { overdue: overdueNow, stall: stallActive },
    };
  }
  return { events, next };
}

const EVENT_META = {
  start:   { icon: '🚀', label: '着手' },
  done:    { icon: '✅', label: '完了' },
  overdue: { icon: '⚠', label: '遅延' },
  stall:   { icon: '⏰', label: '未着手（要着手）' },
};
const EVENT_ORDER = ['overdue', 'stall', 'start', 'done'];

/**
 * diffEvents の結果を Chatwork本文に整形する（1行目＝見出し）。
 * @param {Array} events
 * @param {object} opts { todayKey, title? }
 * @returns {string|null}  変化が無ければ null
 */
export function formatEvents(events, opts = {}) {
  if (!events.length) return null;
  const title = opts.title || `【業務進捗通知】タスク更新 ${events.length}件`;
  const lines = [title];

  for (const type of EVENT_ORDER) {
    const list = events.filter((e) => e.type === type);
    if (!list.length) continue;
    const meta = EVENT_META[type];
    lines.push('');
    lines.push(`${meta.icon} ${meta.label}（${list.length}）`);
    for (const e of list) {
      const t = e.t;
      const who = `${t.memberName} / ${teamName(t.dept)}`;
      let tail = '';
      if (type === 'overdue') tail = `　期限 ${t.key.slice(5)}`;
      else if (type === 'stall') tail = e.days === 0 ? '　本日締切' : `　期限まで${e.days}日`;
      const pr = t.prio === '高' ? '【高】' : '';
      lines.push(`・${pr}${t.title}（${who}）${tail}`);
    }
  }
  return lines.join('\n');
}

/**
 * サマリー → Chatwork本文。1行目が見出し（pushChatworkが[info]装飾）。
 * @param {object} digest  buildDigest の戻り値
 * @param {object} opts    { title?, maxPerTeam? }
 */
export function formatDigest(digest, opts = {}) {
  const maxPerTeam = opts.maxPerTeam || 5;
  const title = opts.title || `業務タスク 締切サマリー（${digest.todayKey || ''}）`;
  const o = digest.overall;
  const lines = [title];
  lines.push(`本日締切 ${o.dueToday.length}件 ／ 遅延 ${o.overdue.length}件 ／ 進行中 ${o.doing}件 ／ 全 ${o.total}件`);

  if (o.overdue.length === 0 && o.dueToday.length === 0) {
    lines.push('');
    lines.push('本日締切・遅延のタスクはありません。');
    return lines.join('\n');
  }

  for (const tm of digest.teams) {
    if (tm.dueToday.length === 0 && tm.overdue.length === 0) continue;
    lines.push('');
    lines.push(`[${tm.name}]  本日締切 ${tm.dueToday.length} / 遅延 ${tm.overdue.length}`);
    const shown = [];
    for (const t of tm.overdue.slice(0, maxPerTeam)) shown.push('⚠ ' + line(t));
    for (const t of tm.dueToday.slice(0, Math.max(0, maxPerTeam - tm.overdue.length))) shown.push('● ' + line(t));
    lines.push(...shown);
    const rest = tm.dueToday.length + tm.overdue.length - shown.length;
    if (rest > 0) lines.push(`…ほか ${rest}件`);
  }
  return lines.join('\n');
}
