// LP・広告の画像制作依頼（Google スプレッドシート「画像作成依頼シート」）の集計。docs/metrics.md「制作依頼」が正。
// 画面はこのモジュールの結果だけを表示し、独自計算をしない。数字はシートの行から数え、推測で埋めない。
import type { SheetCell } from '../sheets/google-sheet';

export type CreativeStatus = 'requested' | 'in_progress' | 'review' | 'revise' | 'done';
export const STATUS_JA: Record<CreativeStatus, string> = {
  requested: '依頼',
  in_progress: '制作中',
  review: '確認待ち',
  revise: '修正',
  done: '完了',
};
export const STATUS_ORDER: CreativeStatus[] = ['requested', 'in_progress', 'review', 'revise', 'done'];

export type DueKind = 'date' | 'today' | 'tomorrow' | 'unknown' | 'none';

export interface CreativeRequest {
  rowNo: number; // シートの行番号（1始まり・見出し込み）
  no: string; // NO. 列（"001" 等）
  designer: string; // 作成者
  saved: string; // 保存先
  status: CreativeStatus;
  statusRaw: string;
  requestedAt: string | null; // YYYY-MM-DD
  dueRaw: string; // 画像納期（原文）
  dueDate: string | null; // YYYY-MM-DD（解釈できた場合）
  dueKind: DueKind;
  requester: string;
  media: string;
  usage: string;
  size: string;
  event: string;
  period: string;
  products: string;
  mainProducts: string;
  content: string;
  emphasis: string;
  reference: string;
}

export interface CreativeSummary {
  total: number;
  open: number; // 完了以外
  done: number;
  overdue: number; // 納期を過ぎて未完了
  dueToday: number;
  dueUnknown: number; // 未完了で納期が解釈できない
  unassigned: number; // 未完了で作成者なし
  byStatus: Record<CreativeStatus, number>;
  byDesigner: { designer: string; open: number; overdue: number }[];
  byRequester: { requester: string; open: number }[];
  duplicateNos: string[];
}

const HEADER_KEYS: { key: keyof CreativeRequest; match: (h: string) => boolean }[] = [
  { key: 'no', match: (h) => /^no\.?$/i.test(h) },
  { key: 'designer', match: (h) => h.startsWith('作成者') },
  { key: 'saved', match: (h) => h.startsWith('保存先') },
  { key: 'requestedAt', match: (h) => h.startsWith('依頼日') },
  { key: 'requester', match: (h) => h.startsWith('依頼者') },
  { key: 'dueRaw', match: (h) => h.startsWith('画像納期') || h.startsWith('納期') },
  { key: 'media', match: (h) => h.startsWith('媒体') },
  { key: 'usage', match: (h) => h.startsWith('用途') },
  { key: 'size', match: (h) => h.startsWith('サイズ') },
  { key: 'event', match: (h) => h.startsWith('イベント') },
  { key: 'period', match: (h) => h.startsWith('期間') },
  { key: 'products', match: (h) => h.startsWith('対象商品') },
  { key: 'mainProducts', match: (h) => h.startsWith('メイン商品') },
  { key: 'content', match: (h) => h.startsWith('内容') },
  { key: 'emphasis', match: (h) => h.startsWith('強調') },
  { key: 'reference', match: (h) => h.startsWith('参考') },
];

const str = (c: SheetCell): string => (c == null ? '' : c instanceof Date ? '' : String(c)).trim();

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** セルの値を YYYY-MM-DD に。Date セル／"26/09/04(金)"／"2026/9/4"／"9/4"（年は baseYear） */
export function parseDateCell(c: SheetCell, baseYear: number): string | null {
  if (c instanceof Date) {
    if (!Number.isFinite(c.getTime())) return null;
    // xlsx の日付セルはローカル時刻の 0:00 として来る。日付部分だけ使う
    return `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())}`;
  }
  const s = str(c);
  if (!s) return null;
  let m = s.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(?:^|[^\d])(\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (m) return ymd(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(?:^|[^\d])(\d{1,2})[\/.月](\d{1,2})/);
  if (m) return ymd(baseYear, Number(m[1]), Number(m[2]));
  return null;
}

/** 納期の自由記入を解釈する。基準日は依頼日（無ければ today） */
export function parseDue(c: SheetCell, base: string | null, today: string): { dueDate: string | null; kind: DueKind } {
  const anchor = base ?? today;
  if (c instanceof Date) return { dueDate: parseDateCell(c, Number(anchor.slice(0, 4))), kind: 'date' };
  const s = str(c);
  if (!s) return { dueDate: null, kind: 'none' };
  if (/本日|今日/.test(s)) return { dueDate: anchor, kind: 'today' };
  if (/明日/.test(s)) return { dueDate: shift(anchor, 1), kind: 'tomorrow' };
  const d = parseDateCell(s, Number(anchor.slice(0, 4)));
  if (d) return { dueDate: d, kind: 'date' };
  return { dueDate: null, kind: 'unknown' };
}

export function normalizeStatus(raw: string, hasContent: boolean): CreativeStatus | null {
  const s = raw.trim();
  if (s.includes('完了') || s === '済') return 'done';
  if (s.includes('確認')) return 'review';
  if (s.includes('修正')) return 'revise';
  if (s.includes('制作') || s.includes('作成中') || s.includes('進行')) return 'in_progress';
  if (s.includes('依頼') || s.includes('未着手')) return 'requested';
  if (s === '') return hasContent ? 'requested' : null;
  return 'requested';
}

/**
 * シートの行列 → 依頼一覧。見出し行は「NO.」を含む行を探す。状態列は見出しが無いので「作成者と依頼日の間の列」を状態として扱う。
 * 依頼者・媒体・内容がすべて空の行は「空行」として除外する。
 */
export function parseCreativeRequests(rows: SheetCell[][], today: string): CreativeRequest[] {
  const hi = rows.findIndex((r) => r.some((c) => /^no\.?$/i.test(str(c))));
  if (hi < 0) return [];
  const header = rows[hi].map(str);
  const col: Partial<Record<keyof CreativeRequest, number>> = {};
  header.forEach((h, i) => {
    for (const k of HEADER_KEYS) if (col[k.key] == null && h && k.match(h)) col[k.key] = i;
  });
  // 状態列: 見出しが空で、作成者〜依頼日の間にある列
  let statusCol = -1;
  if (col.designer != null && col.requestedAt != null) {
    for (let i = col.designer + 1; i < col.requestedAt; i++) if (!header[i]) statusCol = i;
  }
  if (statusCol < 0) {
    const idx = header.findIndex((h) => h.startsWith('状態') || h.startsWith('ステータス'));
    statusCol = idx;
  }
  const get = (r: SheetCell[], k: keyof CreativeRequest): SheetCell => (col[k] == null ? '' : (r[col[k] as number] ?? ''));

  const out: CreativeRequest[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const requester = str(get(r, 'requester'));
    const media = str(get(r, 'media'));
    const content = str(get(r, 'content'));
    const usage = str(get(r, 'usage'));
    const hasContent = Boolean(requester || media || content || usage);
    const statusRaw = statusCol >= 0 ? str(r[statusCol]) : '';
    const status = normalizeStatus(statusRaw, hasContent);
    if (!status) continue;
    if (!hasContent && status !== 'done') continue; // NO. だけの空行
    const noRaw = get(r, 'no');
    const no = typeof noRaw === 'number' ? String(noRaw).padStart(3, '0') : str(noRaw);
    const requestedAt = parseDateCell(get(r, 'requestedAt'), Number(today.slice(0, 4)));
    const dueCell = get(r, 'dueRaw');
    const { dueDate, kind } = parseDue(dueCell, requestedAt, today);
    out.push({
      rowNo: i + 1,
      no,
      designer: str(get(r, 'designer')),
      saved: str(get(r, 'saved')),
      status,
      statusRaw,
      requestedAt,
      dueRaw: dueCell instanceof Date ? (parseDateCell(dueCell, Number(today.slice(0, 4))) ?? '') : str(dueCell),
      dueDate,
      dueKind: kind,
      requester,
      media,
      usage,
      size: str(get(r, 'size')),
      event: str(get(r, 'event')),
      period: str(get(r, 'period')),
      products: str(get(r, 'products')),
      mainProducts: str(get(r, 'mainProducts')),
      content,
      emphasis: str(get(r, 'emphasis')),
      reference: str(get(r, 'reference')),
    });
  }
  return out;
}

export function isOverdue(r: CreativeRequest, today: string): boolean {
  return r.status !== 'done' && r.dueDate != null && r.dueDate < today;
}

export function summarizeCreativeRequests(list: CreativeRequest[], today: string): CreativeSummary {
  const byStatus: Record<CreativeStatus, number> = { requested: 0, in_progress: 0, review: 0, revise: 0, done: 0 };
  const designer = new Map<string, { open: number; overdue: number }>();
  const requester = new Map<string, number>();
  const seen = new Map<string, number>();
  let open = 0;
  let overdue = 0;
  let dueToday = 0;
  let dueUnknown = 0;
  let unassigned = 0;
  for (const r of list) {
    byStatus[r.status]++;
    if (r.no) seen.set(r.no, (seen.get(r.no) ?? 0) + 1);
    if (r.status === 'done') continue;
    open++;
    const od = isOverdue(r, today);
    if (od) overdue++;
    if (r.dueDate === today) dueToday++;
    if (r.dueDate == null) dueUnknown++;
    if (!r.designer) unassigned++;
    const dk = r.designer || '（未定）';
    const d = designer.get(dk) ?? { open: 0, overdue: 0 };
    d.open++;
    if (od) d.overdue++;
    designer.set(dk, d);
    const rk = r.requester || '（不明）';
    requester.set(rk, (requester.get(rk) ?? 0) + 1);
  }
  return {
    total: list.length,
    open,
    done: byStatus.done,
    overdue,
    dueToday,
    dueUnknown,
    unassigned,
    byStatus,
    byDesigner: [...designer].map(([designer, v]) => ({ designer, ...v })).sort((a, b) => b.open - a.open || a.designer.localeCompare(b.designer, 'ja')),
    byRequester: [...requester].map(([requester, open]) => ({ requester, open })).sort((a, b) => b.open - a.open),
    duplicateNos: [...seen].filter(([, n]) => n > 1).map(([no]) => no).sort(),
  };
}

/** 未完了を「期限超過 → 本日 → 納期あり（近い順）→ 納期不明」の順に並べる */
export function sortOpen(list: CreativeRequest[], today: string): CreativeRequest[] {
  const rank = (r: CreativeRequest) => (isOverdue(r, today) ? 0 : r.dueDate === today ? 1 : r.dueDate ? 2 : 3);
  return list
    .filter((r) => r.status !== 'done')
    .sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.rowNo - b.rowNo);
}
