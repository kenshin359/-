// 社内アンケート（Googleフォーム回答スプレッドシート）の集計。docs/metrics.md「社内アンケート」が正。
// 匿名回答のため **回答本文はこのモジュールの出力に一切含めない**（回答があるか／選択肢の分類／進捗のフラグ／日付だけ）。
// 画面はこのモジュールの結果だけを表示し、独自計算をしない。数字はシートの行から数え、推測で埋めない。
import type { SheetCell } from '../sheets/google-sheet';
import { cellStr, parseDateCell, pad2 } from './sheet-cells';

/** 回答から具体策を書くまでの目安（日）。超過かつ具体策なしを「対応遅れ」とする（ヒアリング E6 既定値） */
export const PLAN_DEADLINE_DAYS = 14;

export type QuestionKey = 'workload' | 'atmosphere' | 'consult' | 'rules' | 'supplies' | 'proposal';
export const QUESTION_ORDER: QuestionKey[] = ['workload', 'atmosphere', 'consult', 'rules', 'supplies', 'proposal'];
export const QUESTION_JA: Record<QuestionKey, string> = {
  workload: '仕事量・内容',
  atmosphere: '社内の雰囲気・コミュニケーション',
  consult: '悩みを相談できる人',
  rules: '社内ルール・制度',
  supplies: '備品',
  proposal: 'その他の提案',
};

/** 「相談できる人はいますか」の選択肢の分類（本文は持たない） */
export type ConsultCategory =
  | 'yes_worry' // いる（仕事の悩みがある）
  | 'yes_fine' // いる（仕事の悩みはない）
  | 'no_worry' // いない（仕事の悩みがある）
  | 'no_fine' // いない（仕事の悩みはない）
  | 'yes' // いる（悩みの有無は不明）
  | 'no' // いない（悩みの有無は不明）
  | 'other' // 分類できない回答
  | 'blank'; // 未回答
export const CONSULT_ORDER: ConsultCategory[] = ['yes_worry', 'yes_fine', 'yes', 'no_worry', 'no_fine', 'no', 'other', 'blank'];
export const CONSULT_JA: Record<ConsultCategory, string> = {
  yes_worry: 'いる（悩みあり）',
  yes_fine: 'いる（悩みなし）',
  yes: 'いる（悩みの有無 不明）',
  no_worry: 'いない（悩みあり）',
  no_fine: 'いない（悩みなし）',
  no: 'いない（悩みの有無 不明）',
  other: 'その他の回答',
  blank: '未回答',
};

export interface SurveyResponse {
  /** 回答日 YYYY-MM-DD（タイムスタンプが解釈できなければ null） */
  date: string | null;
  /** 設問ごとに「空でない回答があるか」 */
  answered: Record<QuestionKey, boolean>;
  consult: ConsultCategory;
  /** 「具体策」列が空でない */
  hasPlan: boolean;
  /** 「対応・全体共有」列が TRUE */
  handled: boolean;
  /** 回答日から今日までの経過日数（date が null なら null） */
  daysSince: number | null;
}

export interface SurveySummary {
  today: string;
  total: number;
  /** 月別（YYYY-MM 昇順）。日付不明は含めず noDate に */
  byMonth: { month: string; count: number; withPlan: number; handled: number; pending: number }[];
  noDate: number;
  /** 設問別の回答あり件数 */
  byQuestion: { key: QuestionKey; label: string; answered: number }[];
  /** 相談相手の内訳 */
  consult: Record<ConsultCategory, number>;
  withPlan: number;
  withoutPlan: number;
  handled: number;
  /** 対応・全体共有が TRUE でない件数 */
  pending: number;
  /** 回答から PLAN_DEADLINE_DAYS 日を超えて具体策が無い件数（日付不明は含めない） */
  overdue: number;
  planDeadlineDays: number;
}

const QUESTION_MATCH: { key: QuestionKey; match: (h: string) => boolean }[] = [
  { key: 'workload', match: (h) => h.includes('仕事量') },
  { key: 'atmosphere', match: (h) => h.includes('雰囲気') || h.includes('コミュニケーション') },
  { key: 'consult', match: (h) => h.includes('相談') || h.startsWith('仕事の悩み') },
  { key: 'rules', match: (h) => h.includes('ルール') || h.includes('制度') },
  { key: 'supplies', match: (h) => h.includes('備品') },
  { key: 'proposal', match: (h) => h.startsWith('その他') || h.includes('提案') },
];

export interface SurveyColumns {
  timestamp: number;
  questions: Partial<Record<QuestionKey, number>>;
  plan: number | null;
  handled: number | null;
}

const isTimestampHeader = (h: string) => h.startsWith('タイムスタンプ') || /^timestamp$/i.test(h);

/** 見出し行（「タイムスタンプ」で始まる行）を探し、列位置を決める。見出しが無いタブは null */
export function detectSurveyColumns(rows: SheetCell[][]): { headerIndex: number; cols: SurveyColumns } | null {
  const hi = rows.findIndex((r) => r.some((c) => isTimestampHeader(cellStr(c))));
  if (hi < 0) return null;
  const header = rows[hi].map(cellStr);
  const timestamp = header.findIndex(isTimestampHeader);
  const questions: Partial<Record<QuestionKey, number>> = {};
  let plan: number | null = null;
  let handled: number | null = null;
  header.forEach((h, i) => {
    if (!h || i === timestamp) return;
    if (h.startsWith('具体策')) {
      if (plan == null) plan = i;
      return;
    }
    if (h.startsWith('対応') || h.includes('全体共有')) {
      if (handled == null) handled = i;
      return;
    }
    for (const q of QUESTION_MATCH) {
      if (questions[q.key] == null && q.match(h)) {
        questions[q.key] = i;
        return;
      }
    }
  });
  return { headerIndex: hi, cols: { timestamp, questions, plan, handled } };
}

/** 選択肢の分類。本文は返さない */
export function classifyConsult(raw: SheetCell): ConsultCategory {
  const s = cellStr(raw).replace(/\s/g, '');
  if (!s) return 'blank';
  const exists = /いない|いません|居ない/.test(s) ? false : /いる|います|居る/.test(s) ? true : null;
  const worry = /悩み(は|が)?(ない|無い|なし|ありません)/.test(s) ? false : /悩み(が|は)?(ある|あり|有る)/.test(s) ? true : null;
  if (exists === true) return worry === true ? 'yes_worry' : worry === false ? 'yes_fine' : 'yes';
  if (exists === false) return worry === true ? 'no_worry' : worry === false ? 'no_fine' : 'no';
  return 'other';
}

/** TRUE/FALSE・チェックボックス・「済」等を真偽に */
export function cellBool(c: SheetCell): boolean {
  if (typeof c === 'boolean') return c;
  if (typeof c === 'number') return c !== 0;
  const s = cellStr(c).toLowerCase();
  return s === 'true' || s === '1' || s === '✓' || s === '✔' || s === '済' || s === '完了' || s === '対応済';
}

/** 重複判定用のタイムスタンプ表現（秒まで）。本文は含めない */
function timestampKey(c: SheetCell): string {
  if (c instanceof Date) {
    if (!Number.isFinite(c.getTime())) return '';
    return `${c.getFullYear()}-${pad2(c.getMonth() + 1)}-${pad2(c.getDate())} ${pad2(c.getHours())}:${pad2(c.getMinutes())}:${pad2(c.getSeconds())}`;
  }
  return cellStr(c).replace(/[\/.]/g, '-').replace(/\s+/g, ' ');
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

interface Draft extends SurveyResponse {
  key: string;
}

function parseTab(rows: SheetCell[][], today: string): Draft[] {
  const det = detectSurveyColumns(rows);
  if (!det) return [];
  const { headerIndex, cols } = det;
  const out: Draft[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const tsCell = r[cols.timestamp] ?? '';
    const tsKey = timestampKey(tsCell);
    if (!tsKey) continue; // タイムスタンプの無い行は回答ではない
    const date = parseDateCell(tsCell, Number(today.slice(0, 4)));
    const answered = {} as Record<QuestionKey, boolean>;
    for (const q of QUESTION_ORDER) {
      const ci = cols.questions[q];
      answered[q] = ci != null && cellStr(r[ci] ?? '') !== '';
    }
    const consult = cols.questions.consult != null ? classifyConsult(r[cols.questions.consult] ?? '') : 'blank';
    const hasPlan = cols.plan != null && cellStr(r[cols.plan] ?? '') !== '';
    const handled = cols.handled != null && cellBool(r[cols.handled] ?? '');
    // 重複キー: タイムスタンプ＋設問1の本文。本文はキーの材料にだけ使い、出力には残さない
    const q1 = cols.questions.workload != null ? cellStr(r[cols.questions.workload] ?? '') : '';
    out.push({
      key: `${tsKey}|${q1}`,
      date,
      answered,
      consult,
      hasPlan,
      handled,
      daysSince: date ? daysBetween(date, today) : null,
    });
  }
  return out;
}

/**
 * 全タブの行列 → 回答一覧。「タイムスタンプ」見出しを持つタブだけを対象にし、
 * タイムスタンプ＋設問1が同一の行は1件に寄せる（具体策・対応済みはいずれかのタブにあれば採用）。
 */
export function parseSurveyTabs(tabs: SheetCell[][][], today: string): SurveyResponse[] {
  const merged = new Map<string, Draft>();
  for (const rows of tabs) {
    for (const d of parseTab(rows, today)) {
      const prev = merged.get(d.key);
      if (!prev) {
        merged.set(d.key, d);
        continue;
      }
      prev.hasPlan = prev.hasPlan || d.hasPlan;
      prev.handled = prev.handled || d.handled;
      for (const q of QUESTION_ORDER) prev.answered[q] = prev.answered[q] || d.answered[q];
      if (prev.consult === 'blank') prev.consult = d.consult;
      if (!prev.date && d.date) {
        prev.date = d.date;
        prev.daysSince = d.daysSince;
      }
    }
  }
  return [...merged.values()]
    .map((d) => ({ date: d.date, answered: d.answered, consult: d.consult, hasPlan: d.hasPlan, handled: d.handled, daysSince: d.daysSince }))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

export function isPlanOverdue(r: SurveyResponse, deadlineDays = PLAN_DEADLINE_DAYS): boolean {
  return !r.hasPlan && r.daysSince != null && r.daysSince > deadlineDays;
}

export function summarizeSurvey(list: SurveyResponse[], today: string, deadlineDays = PLAN_DEADLINE_DAYS): SurveySummary {
  const months = new Map<string, { count: number; withPlan: number; handled: number; pending: number }>();
  const consult = Object.fromEntries(CONSULT_ORDER.map((k) => [k, 0])) as Record<ConsultCategory, number>;
  const byQ = Object.fromEntries(QUESTION_ORDER.map((k) => [k, 0])) as Record<QuestionKey, number>;
  let noDate = 0;
  let withPlan = 0;
  let handled = 0;
  let pending = 0;
  let overdue = 0;
  for (const r of list) {
    if (r.date) {
      const m = r.date.slice(0, 7);
      const v = months.get(m) ?? { count: 0, withPlan: 0, handled: 0, pending: 0 };
      v.count++;
      if (r.hasPlan) v.withPlan++;
      if (r.handled) v.handled++;
      else v.pending++;
      months.set(m, v);
    } else noDate++;
    for (const q of QUESTION_ORDER) if (r.answered[q]) byQ[q]++;
    consult[r.consult]++;
    if (r.hasPlan) withPlan++;
    if (r.handled) handled++;
    else pending++;
    if (isPlanOverdue(r, deadlineDays)) overdue++;
  }
  return {
    today,
    total: list.length,
    byMonth: [...months]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    noDate,
    byQuestion: QUESTION_ORDER.map((key) => ({ key, label: QUESTION_JA[key], answered: byQ[key] })),
    consult,
    withPlan,
    withoutPlan: list.length - withPlan,
    handled,
    pending,
    overdue,
    planDeadlineDays: deadlineDays,
  };
}
