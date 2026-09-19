// SNS投稿スケジュール（Google スプレッドシート「SNS投稿スケジュール」）の集計。docs/metrics.md「SNS投稿」が正。
// 画面はこのモジュールの結果だけを表示し、独自計算をしない。シートが正（ダッシュボードは読むだけ）。
import type { SheetCell } from '../sheets/google-sheet';
import { cellStr, parseDateCell, parseTimeCell, shiftDate } from './sheet-cells';

export type PostStatus = 'draft' | 'pending' | 'scheduled' | 'posted';
export const POST_STATUS_JA: Record<PostStatus, string> = { draft: '案', pending: '承認待ち', scheduled: '予約済', posted: '投稿済' };
export const POST_STATUS_ORDER: PostStatus[] = ['draft', 'pending', 'scheduled', 'posted'];

export interface SnsPost {
  rowNo: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM or ''
  media: string;
  account: string;
  owner: string;
  content: string;
  assetLink: string;
  status: PostStatus;
  statusRaw: string;
  postUrl: string;
  likes: number | null;
  views: number | null;
  memo: string;
}

export interface SnsSummary {
  total: number;
  today: SnsPost[];
  /** 予定日を過ぎて投稿済でない */
  unposted: SnsPost[];
  /** 今日から7日先まで（今日含む） */
  upcoming7: SnsPost[];
  pending: SnsPost[];
  /** 明日〜3日先に予定が1件も無い */
  gap3: boolean;
  monthByMedia: { media: string; planned: number; posted: number }[];
  /** 今月の投稿済 */
  monthPosted: number;
  monthPlanned: number;
}

const HEAD: { key: keyof SnsPost; match: (h: string) => boolean }[] = [
  { key: 'date', match: (h) => h.startsWith('投稿予定日') || h === '日付' },
  { key: 'time', match: (h) => h.startsWith('時刻') || h.startsWith('時間') },
  { key: 'media', match: (h) => h.startsWith('媒体') },
  { key: 'account', match: (h) => h.startsWith('アカウント') },
  { key: 'owner', match: (h) => h.startsWith('担当') },
  { key: 'content', match: (h) => h.startsWith('内容') },
  { key: 'assetLink', match: (h) => h.startsWith('素材') },
  { key: 'status', match: (h) => h.startsWith('状態') || h.startsWith('ステータス') },
  { key: 'postUrl', match: (h) => h.startsWith('投稿URL') },
  { key: 'likes', match: (h) => h.includes('いいね') },
  { key: 'views', match: (h) => h.includes('再生') },
  { key: 'memo', match: (h) => h.startsWith('メモ') || h.startsWith('備考') },
];

export function normalizePostStatus(raw: string): PostStatus {
  const s = raw.trim();
  if (s.includes('投稿済') || s.includes('公開') || s === '済') return 'posted';
  if (s.includes('予約')) return 'scheduled';
  if (s.includes('承認') || s.includes('確認')) return 'pending';
  return 'draft';
}

function num(c: SheetCell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  const s = cellStr(c).replace(/[,，]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 行列 → 投稿一覧。見出し行は「投稿予定日」を含む行。予定日が解釈できない行は除外（推測で埋めない） */
export function parseSnsPosts(rows: SheetCell[][], today: string): SnsPost[] {
  const hi = rows.findIndex((r) => r.some((c) => /^投稿予定日|^日付$/.test(cellStr(c))));
  if (hi < 0) return [];
  const header = rows[hi].map(cellStr);
  const col: Partial<Record<keyof SnsPost, number>> = {};
  header.forEach((h, i) => {
    for (const k of HEAD) if (col[k.key] == null && h && k.match(h)) col[k.key] = i;
  });
  const get = (r: SheetCell[], k: keyof SnsPost): SheetCell => (col[k] == null ? '' : (r[col[k] as number] ?? ''));
  const out: SnsPost[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const date = parseDateCell(get(r, 'date'), Number(today.slice(0, 4)));
    if (!date) continue;
    const statusRaw = cellStr(get(r, 'status'));
    out.push({
      rowNo: i + 1,
      date,
      time: parseTimeCell(get(r, 'time')),
      media: cellStr(get(r, 'media')),
      account: cellStr(get(r, 'account')),
      owner: cellStr(get(r, 'owner')),
      content: cellStr(get(r, 'content')),
      assetLink: cellStr(get(r, 'assetLink')),
      status: normalizePostStatus(statusRaw),
      statusRaw,
      postUrl: cellStr(get(r, 'postUrl')),
      likes: num(get(r, 'likes')),
      views: num(get(r, 'views')),
      memo: cellStr(get(r, 'memo')),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.rowNo - b.rowNo);
}

export function summarizeSns(posts: SnsPost[], today: string): SnsSummary {
  const month = today.slice(0, 7);
  const d7 = shiftDate(today, 7);
  const d3 = shiftDate(today, 3);
  const byMedia = new Map<string, { planned: number; posted: number }>();
  let monthPosted = 0;
  let monthPlanned = 0;
  for (const p of posts) {
    if (!p.date.startsWith(month)) continue;
    monthPlanned++;
    const m = byMedia.get(p.media || '（媒体なし）') ?? { planned: 0, posted: 0 };
    m.planned++;
    if (p.status === 'posted') {
      m.posted++;
      monthPosted++;
    }
    byMedia.set(p.media || '（媒体なし）', m);
  }
  const future = posts.filter((p) => p.date > today && p.date <= d3 && p.status !== 'posted');
  return {
    total: posts.length,
    today: posts.filter((p) => p.date === today),
    unposted: posts.filter((p) => p.date < today && p.status !== 'posted'),
    upcoming7: posts.filter((p) => p.date >= today && p.date <= d7),
    pending: posts.filter((p) => p.status === 'pending' && p.date >= today),
    gap3: future.length === 0,
    monthByMedia: [...byMedia].map(([media, v]) => ({ media, ...v })).sort((a, b) => b.planned - a.planned),
    monthPosted,
    monthPlanned,
  };
}
