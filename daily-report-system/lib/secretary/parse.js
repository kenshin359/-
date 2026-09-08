// ============================================================
//  AI秘書：朝に貼り付けたタスク一覧を読み取る
// ------------------------------------------------------------
//  「・LP改修 90分」のような普通の箇条書きをそのまま渡せます。
//  書き足せる目印（すべて任意）:
//    90分 / 1.5時間 / [45]   … 所要時間
//    14:00-15:00 / 15時から  … 時間が決まっている予定（会議など）
//    @佐藤                   … 依頼先（決まっている場合）
//    !! / 【至急】            … 緊急度（! の数 1〜3）
//    〆9/10 / 締切:今日       … 締切
//    #THINK                  … カテゴリを手で指定（自動判定より優先）
// ============================================================

const CATEGORY_NAMES = ['THINK', 'IMPROVE', 'DELEGATE', 'MEETING', 'MANAGEMENT', 'ADMIN'];

// 見出し・区切り線・空行はタスクではない
const SKIP_RE = /^(?:[\s━─―—=＝\-*_]+|#{1,6}[^#].*|【[^】]*】|.*[:：]\s*)$/;

const BULLET_RE = /^\s*(?:[-*・•●▪◯○☑□>＞]+|\d{1,2}\s*[.)、．]|[（(]\d{1,2}[）)])\s*/;

/** 表記ゆれを吸収した比較用キー（日をまたいで同じタスクを追跡するのに使う） */
export function normalizeTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[!！?？。、,，.．・「」『』（）()【】\[\]]/g, '');
}

/** 短い安定ID（同じ文言なら毎日同じIDになる） */
export function taskId(title) {
  const s = normalizeTitle(title);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function hhmm(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
}

/** 1行を1タスクに変換。タスクでない行は null */
export function parseLine(line) {
  const raw = String(line ?? '').replace(/\t/g, ' ').trimEnd();
  if (!raw.trim()) return null;
  let s = raw.replace(BULLET_RE, '').trim();
  if (!s || SKIP_RE.test(s)) return null;

  const t = { raw: raw.trim(), minutes: null, fixed: null, assignee: null, category: null, urgencyMark: 0, deadline: null };

  // ① 時刻（先に抜く。所要時間の「30分」と混ざらないように）
  const range = s.match(/(\d{1,2})[:：](\d{2})\s*[-〜~–—ー]\s*(\d{1,2})[:：](\d{2})/);
  if (range) {
    t.fixed = { start: hhmm(+range[1], +range[2]), end: hhmm(+range[3], +range[4]) };
    s = s.replace(range[0], ' ');
  } else {
    const from = s.match(/(\d{1,2})[:：時](\d{2})?\s*(?:分)?\s*(?:から|〜|~|開始)/);
    if (from) {
      t.fixed = { start: hhmm(+from[1], from[2] ? +from[2] : 0), end: null };
      s = s.replace(from[0], ' ');
    }
  }

  // ② 所要時間
  const bracket = s.match(/[\[［](\d{1,3})\s*分?[\]］]/);
  const hours = s.match(/(\d{1,2}(?:\.\d)?)\s*時間(?:(\d{1,2})分)?/);
  const mins = s.match(/(\d{1,3})\s*分(?!析)/);
  if (bracket) { t.minutes = +bracket[1]; s = s.replace(bracket[0], ' '); }
  else if (hours) { t.minutes = Math.round(+hours[1] * 60) + (hours[2] ? +hours[2] : 0); s = s.replace(hours[0], ' '); }
  else if (mins) { t.minutes = +mins[1]; s = s.replace(mins[0], ' '); }

  // ③ 依頼先 / カテゴリ指定
  const at = s.match(/[@＠]([^\s、,，]+)/);
  if (at) { t.assignee = at[1]; s = s.replace(at[0], ' '); }
  const tag = s.match(new RegExp(`[#＃](${CATEGORY_NAMES.join('|')})`, 'i'));
  if (tag) { t.category = tag[1].toUpperCase(); s = s.replace(tag[0], ' '); }

  // ④ 締切
  const md = s.match(/(?:〆|締切|期限)\s*[:：]?\s*(\d{1,2})\s*[\/月]\s*(\d{1,2})/);
  if (md) {
    t.deadline = `${String(md[1]).padStart(2, '0')}-${String(md[2]).padStart(2, '0')}`;
    s = s.replace(md[0], ' ');
  } else if (/(?:〆|締切|期限)\s*[:：]?\s*(今日|本日)/.test(s)) {
    t.deadline = 'today';
  } else if (/(?:〆|締切|期限)\s*[:：]?\s*明日/.test(s)) {
    t.deadline = 'tomorrow';
  }

  // ⑤ 緊急マーク（! の数）
  const bangs = s.match(/[!！]+\s*$/);
  if (bangs) { t.urgencyMark = Math.min(3, bangs[0].trim().length); s = s.replace(bangs[0], ' '); }

  t.title = s.replace(/\s{2,}/g, ' ').replace(/^[\s　:：・-]+|[\s　:：・-]+$/g, '').trim();
  if (!t.title) return null;
  t.id = taskId(t.title);
  return t;
}

/** 貼り付けたテキスト全体 → タスク配列（重複行はまとめる） */
export function parseTasks(text) {
  const out = [];
  const seen = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = parseLine(line);
    if (!t) continue;
    const prev = seen.get(t.id);
    if (prev) {                       // 同じ内容が2回書かれていたら情報の多い方を残す
      if (t.minutes && !prev.minutes) prev.minutes = t.minutes;
      if (t.fixed && !prev.fixed) prev.fixed = t.fixed;
      if (t.urgencyMark > prev.urgencyMark) prev.urgencyMark = t.urgencyMark;
      continue;
    }
    seen.set(t.id, t);
    out.push(t);
  }
  return out;
}
