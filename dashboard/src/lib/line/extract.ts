// LINEメッセージから「依頼・約束・期限」をルールで抽出する（LLM不使用・決定的）。
// prisma に依存しない純関数。webhook と画面（候補表示）から使う。
//
// 方針:
//  - 依頼句（お願いします／してください／までに／期限／締切 …）があれば confidence=high
//  - 約束句（やります／対応します …）は期限か担当が取れたときだけ high、それ以外は low
//  - 担当は「@名前」か文頭の「名前さん」から取る
//  - 期限は「9/20」「9月20日」「20日まで」「今日」「明日」「明後日」「今週中」「来週」「月末」「金曜まで」を JST の now 基準で解決

export interface Extracted {
  title: string; // ≤80文字
  assigneeName?: string;
  due?: string; // 'YYYY-MM-DD'
  confidence: 'high' | 'low';
  kind: 'request' | 'promise';
}

const REQUEST_PATTERNS: RegExp[] = [
  /お願い(?:し|いた)?(?:ます|致します|いたします)?/,
  /(?:して|やって|見て|みて|送って|出して|確認して|対応して|作って|直して|入れて|準備して|共有して|連絡して|提出して|教えて)(?:下さい|ください|もらえ(?:ます|る)|いただけ(?:ます|る)|欲しい|ほしい|頂け(?:ます|る))/,
  /までに/,
  /期限/,
  /締(?:め)?切(?:り)?/,
  /(?:を|の)?(?:依頼|お願い)(?:です|します)/,
  /必ず.*(?:して|やって)/,
  /(?:^|\s)(?:TODO|todo|ToDo)\b/,
];

const PROMISE_PATTERNS: RegExp[] = [
  /(?:やり|対応し|確認し|提出し|送り|作り|準備し|共有し|連絡し|直し|進め|出し)(?:ます|ておきます|とく|ときます|ておく)/,
  /(?:やっ|対応し|確認し|提出し|送っ|作っ|準備し|共有し|連絡し|直し|進め|出し)て(?:おきます|おく|ときます|とく)/,
  /任せてください/,
];

const COMPLETION_PATTERNS: RegExp[] = [
  /完了(?:しました|です|しま?した|！|!|$)/,
  /(?:終わり|おわり)ました/,
  /(?:終わった|おわった|終了しました)/,
  /(?:対応|送付|提出|共有|修正|確認|作成|入稿|発注|返信|設定)(?:済み|済|しました|できました|完了)/,
  /(?:できました|出来ました)/,
  /\bdone\b/i,
  /^(?:済|済み|OK|ok|了|完了)$/,
];

const NAME = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}A-Za-zー]{1,10}';
const MENTION_RE = new RegExp(`@(${NAME})`, 'gu');
const LEADING_NAME_RE = new RegExp(`^\\s*(${NAME}?)(?:さん|くん|君|ちゃん|部長|課長|リーダー)[、,\\s：:]?`, 'u');
const NOT_A_PERSON = /^(?:皆|みな|みんな|皆様|各位|お客|全員|監査役|all)$/i;

// ---------- 日付（JST） ----------

/** now を JST の {y,m,d,dow} に */
function jstParts(now: Date): { y: number; m: number; d: number; dow: number } {
  const t = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}

function key(y: number, m: number, d: number): string {
  // Date.UTC は月末超過を正規化する（9/31 → 10/1）。妥当性チェックは呼び出し側で行う
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

function plusDays(now: Date, n: number): string {
  const { y, m, d } = jstParts(now);
  return key(y, m, d + n);
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function validMd(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m);
}

const DOW: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

/** 本文から期限（YYYY-MM-DD）を取り出す。見つからなければ undefined */
export function parseDue(text: string, now: Date): string | undefined {
  const { y, m, d, dow } = jstParts(now);
  const today = key(y, m, d);

  // 9/20, 9月20日（年は今年。すでに半年以上過ぎていれば来年）
  const md = text.match(/(?<!\d)(\d{1,2})[\/／月](\d{1,2})日?(?!\d)/);
  if (md) {
    const mm = Number(md[1]);
    const dd = Number(md[2]);
    if (validMd(y, mm, dd)) {
      let k = key(y, mm, dd);
      if (k < today) {
        const diff = (Date.UTC(y, m - 1, d) - Date.UTC(y, mm - 1, dd)) / 86_400_000;
        if (diff > 180) k = key(y + 1, mm, dd);
      }
      return k;
    }
  }

  // 「20日まで」「20日締切」「20日期限」（今月。過ぎていれば来月）
  const dayOnly = text.match(/(?<![\d\/／月])(\d{1,2})日\s*(?:まで|迄|締|期限|中に|に)/);
  if (dayOnly) {
    const dd = Number(dayOnly[1]);
    if (dd >= 1 && dd <= 31) {
      if (dd >= d && dd <= lastDayOfMonth(y, m)) return key(y, m, dd);
      const nm = m === 12 ? 1 : m + 1;
      const ny = m === 12 ? y + 1 : y;
      if (dd <= lastDayOfMonth(ny, nm)) return key(ny, nm, dd);
    }
  }

  if (/来月末/.test(text)) {
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return key(ny, nm, lastDayOfMonth(ny, nm));
  }
  if (/月末|今月中/.test(text)) return key(y, m, lastDayOfMonth(y, m));
  if (/明後日/.test(text)) return plusDays(now, 2);
  if (/明日|あした/.test(text)) return plusDays(now, 1);
  if (/今日|本日|きょう/.test(text)) return today;
  if (/来週/.test(text)) {
    // 来週 = 来週の金曜（「来週まで」の実務上の期限）
    const daysToNextMonday = ((8 - dow) % 7) || 7;
    return plusDays(now, daysToNextMonday + 4);
  }
  if (/今週/.test(text)) {
    // 今週中 = 今週の金曜（土日に言われたら日曜）
    if (dow === 6) return plusDays(now, 1);
    if (dow === 0) return today;
    return plusDays(now, 5 - dow);
  }
  const wd = text.match(/([月火水木金土日])曜/);
  if (wd) {
    const target = DOW[wd[1]];
    let n = (target - dow + 7) % 7;
    if (n === 0 && /来週/.test(text)) n = 7;
    return plusDays(now, n);
  }
  return undefined;
}

// ---------- 担当 ----------

export function parseAssignee(text: string): string | undefined {
  const mention = [...text.matchAll(MENTION_RE)].map((m) => m[1]);
  // ボット自身への @監査役 は担当ではない
  const human = mention.find((n) => !NOT_A_PERSON.test(n));
  if (human) return human;
  const lead = text.match(LEADING_NAME_RE);
  if (lead && lead[1] && !NOT_A_PERSON.test(lead[1])) return lead[1];
  return undefined;
}

// ---------- タイトル ----------

function cleanTitle(text: string): string {
  let t = text
    .replace(MENTION_RE, ' ')
    .replace(LEADING_NAME_RE, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 依頼句を含む最初の文を採用（長文の冒頭挨拶を避ける）
  const sentences = t.split(/(?<=[。！!？?])\s*/).filter(Boolean);
  const hit = sentences.find((s) => REQUEST_PATTERNS.some((p) => p.test(s)) || PROMISE_PATTERNS.some((p) => p.test(s)));
  if (hit) t = hit.trim();
  t = t.replace(/[。！!]+$/, '');
  if (t.length > 80) t = `${t.slice(0, 79)}…`;
  return t;
}

// ---------- 本体 ----------

/** 依頼・約束を抽出する。該当なしは null */
export function extract(text: string, now = new Date()): Extracted | null {
  const raw = text ?? '';
  if (!raw.trim()) return null;
  if (raw.length > 2000) return null;
  const isRequest = REQUEST_PATTERNS.some((p) => p.test(raw));
  const isPromise = !isRequest && PROMISE_PATTERNS.some((p) => p.test(raw));
  if (!isRequest && !isPromise) return null;
  // 完了報告と同時に出る「〜します」は約束扱いにしない
  if (isPromise && isCompletion(raw)) return null;

  const assigneeName = parseAssignee(raw);
  const due = parseDue(raw, now);
  const title = cleanTitle(raw);
  if (!title) return null;

  const confidence: Extracted['confidence'] = isRequest ? 'high' : due || assigneeName ? 'high' : 'low';
  return {
    title,
    ...(assigneeName ? { assigneeName } : {}),
    ...(due ? { due } : {}),
    confidence,
    kind: isRequest ? 'request' : 'promise',
  };
}

/** 完了報告か（「完了」「終わりました」「done」など） */
export function isCompletion(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  return COMPLETION_PATTERNS.some((p) => p.test(t));
}

/** 完了報告と追いかけの本文の近さ（0〜1）。共通する2文字以上の語の割合 */
export function similarity(a: string, b: string): number {
  const toks = (s: string) =>
    new Set(
      s
        .replace(MENTION_RE, ' ')
        .split(/[\s、。,.!?！？「」（）()・:：/／]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 2),
    );
  const ta = toks(a);
  const tb = toks(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const w of ta) if (tb.has(w) || [...tb].some((x) => x.includes(w) || w.includes(x))) hit++;
  return hit / Math.min(ta.size, tb.size);
}
