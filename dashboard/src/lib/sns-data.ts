// SNS投稿カレンダーのデータ取得。シートは SHEET_SNS_SCHEDULE_ID（タブ名 SHEET_SNS_SCHEDULE_TAB、空なら最初のタブ）。
// 未設定・取得失敗は「未接続」として理由を返す（成功と偽らない）。集計は src/lib/metrics/sns-schedule.ts のみ。
import { fetchSheetRows } from './sheets/google-sheet';
import { parseSnsPosts, summarizeSns, type SnsPost, type SnsSummary } from './metrics/sns-schedule';
import { jstDateKey } from './metrics/format';

export type SnsData =
  | { status: 'ok'; today: string; sheetUrl: string; fetchedAt: Date; posts: SnsPost[]; summary: SnsSummary }
  | { status: 'unavailable'; today: string; sheetUrl: string | null; reason: string };

export async function getSnsData(now = new Date()): Promise<SnsData> {
  const today = jstDateKey(now);
  const id = (process.env.SHEET_SNS_SCHEDULE_ID || '').trim();
  const tab = (process.env.SHEET_SNS_SCHEDULE_TAB || '').trim() || undefined;
  if (!id) return { status: 'unavailable', today, sheetUrl: null, reason: 'SNS投稿スケジュールのシートが未設定です（環境変数 SHEET_SNS_SCHEDULE_ID）' };
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  try {
    const { rows, fetchedAt } = await fetchSheetRows(id, tab);
    const posts = parseSnsPosts(rows, today);
    return { status: 'ok', today, sheetUrl, fetchedAt, posts, summary: summarizeSns(posts, today) };
  } catch (e) {
    return { status: 'unavailable', today, sheetUrl, reason: e instanceof Error ? e.message : String(e) };
  }
}
