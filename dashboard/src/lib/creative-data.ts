// 制作依頼ボードのデータ取得。シートは SHEET_LP_REQUESTS_ID（タブ名 SHEET_LP_REQUESTS_TAB、既定「依頼シート」）。
// 未設定・取得失敗は「未接続」として理由を返す（成功と偽らない）。集計は src/lib/metrics/creative-requests.ts のみ。
import { fetchSheetRows } from './sheets/google-sheet';
import { parseCreativeRequests, summarizeCreativeRequests, type CreativeRequest, type CreativeSummary } from './metrics/creative-requests';
import { jstDateKey } from './metrics/format';

export type CreativeData =
  | { status: 'ok'; today: string; sheetUrl: string; fetchedAt: Date; list: CreativeRequest[]; summary: CreativeSummary }
  | { status: 'unavailable'; today: string; sheetUrl: string | null; reason: string };

export function creativeSheetConfig(): { id: string | null; tab: string } {
  const id = (process.env.SHEET_LP_REQUESTS_ID || '').trim() || null;
  const tab = (process.env.SHEET_LP_REQUESTS_TAB || '').trim() || '依頼シート';
  return { id, tab };
}

export async function getCreativeData(now = new Date()): Promise<CreativeData> {
  const today = jstDateKey(now);
  const { id, tab } = creativeSheetConfig();
  if (!id) return { status: 'unavailable', today, sheetUrl: null, reason: '画像作成依頼シートが未設定です（環境変数 SHEET_LP_REQUESTS_ID）' };
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  try {
    const { rows, fetchedAt } = await fetchSheetRows(id, tab);
    const list = parseCreativeRequests(rows, today);
    return { status: 'ok', today, sheetUrl, fetchedAt, list, summary: summarizeCreativeRequests(list, today) };
  } catch (e) {
    return { status: 'unavailable', today, sheetUrl, reason: e instanceof Error ? e.message : String(e) };
  }
}
