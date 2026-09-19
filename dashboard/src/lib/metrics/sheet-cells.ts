// スプレッドシートのセル値の共通解釈（文字列化・日付）。制作依頼・SNS投稿スケジュールで共用。
import type { SheetCell } from '../sheets/google-sheet';

export const cellStr = (c: SheetCell): string => (c == null ? '' : c instanceof Date ? '' : String(c)).trim();

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** セルの値を YYYY-MM-DD に。Date セル／"26/09/04(金)"／"2026/9/4"／"9/4"（年は baseYear）。解釈できなければ null */
export function parseDateCell(c: SheetCell, baseYear: number): string | null {
  if (c instanceof Date) {
    if (!Number.isFinite(c.getTime())) return null;
    // xlsx の日付セルはローカル時刻の 0:00 として来る。日付部分だけ使う
    return `${c.getFullYear()}-${pad2(c.getMonth() + 1)}-${pad2(c.getDate())}`;
  }
  const s = cellStr(c);
  if (!s) return null;
  let m = s.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(?:^|[^\d])(\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (m) return ymd(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(?:^|[^\d])(\d{1,2})[\/.月](\d{1,2})/);
  if (m) return ymd(baseYear, Number(m[1]), Number(m[2]));
  return null;
}

/** 時刻セル（Date／"12:30"／"12時"）を HH:MM に。無ければ '' */
export function parseTimeCell(c: SheetCell): string {
  if (c instanceof Date) return Number.isFinite(c.getTime()) ? `${pad2(c.getHours())}:${pad2(c.getMinutes())}` : '';
  if (typeof c === 'number' && c >= 0 && c < 1) {
    const mins = Math.round(c * 24 * 60);
    return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
  }
  const s = cellStr(c);
  const m = s.match(/(\d{1,2})[:時](\d{2})?/);
  if (!m) return '';
  return `${pad2(Number(m[1]))}:${pad2(Number(m[2] ?? 0))}`;
}
