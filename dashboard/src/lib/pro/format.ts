// PRO 画面共通の日付・期限まわりの表示ヘルパー（prisma に依存しない。クライアントからも import 可）。
// TaskBoard.tsx の fmtDue / daysBetween と同じ計算にそろえる（画面ごとに期限表示が違わないように）。

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → 'M/D(曜)' */
export function fmtDue(due: string): string {
  const [y, m, d] = due.split('-').map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${w})`;
}

/** 'YYYY-MM-DD' → 'M月D日(曜)' （挨拶行など） */
export function fmtDateJa(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日(${w})`;
}

/** a から b までの日数（b - a）。両方 'YYYY-MM-DD' */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** 'YYYY-MM-DD' に n 日足す */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** ISO日時 → 'M/D HH:mm'（JST） */
export function fmtDateTimeJa(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** ISO日時 → 'M/D'（JST） */
export function fmtDateShortJa(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
}

/** 担当者名とログイン名の前方一致（TaskBoard.matchesUser と同じ。空白は無視） */
export function matchesUser(assignee: string, userName: string): boolean {
  if (!assignee || !userName) return false;
  const a = assignee.replace(/\s/g, '');
  const u = userName.replace(/\s/g, '');
  return u.startsWith(a) || a.startsWith(u);
}

/** JSTの時刻に合わせた挨拶 */
export function greetingFor(now: Date): string {
  const h = (now.getUTCHours() + 9) % 24;
  if (h < 11) return 'おはようございます';
  if (h < 18) return 'こんにちは';
  return 'おつかれさまです';
}
