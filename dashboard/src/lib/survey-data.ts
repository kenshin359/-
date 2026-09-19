// 社内アンケート（Googleフォーム回答スプレッドシート）のデータ取得。シートは SHEET_SURVEY_ID（全タブを走査）。
// 未設定・取得失敗は「未接続」として理由を返す（成功と偽らない）。集計は src/lib/metrics/survey.ts のみ。
// 匿名回答の本文はここでも保持しない（集計結果だけを返す）。
import { fetchSheetTabs } from './sheets/google-sheet';
import { detectSurveyColumns, parseSurveyTabs, summarizeSurvey, type SurveySummary } from './metrics/survey';
import { jstDateKey } from './metrics/format';

export type SurveyData =
  | { status: 'ok'; today: string; sheetUrl: string; fetchedAt: Date; tabCount: number; responseTabCount: number; summary: SurveySummary }
  | { status: 'unavailable'; today: string; sheetUrl: string | null; reason: string };

export function surveySheetId(): string | null {
  return (process.env.SHEET_SURVEY_ID || '').trim() || null;
}

export async function getSurveyData(now = new Date()): Promise<SurveyData> {
  const today = jstDateKey(now);
  const id = surveySheetId();
  if (!id) return { status: 'unavailable', today, sheetUrl: null, reason: '社内アンケートの回答シートが未設定です（環境変数 SHEET_SURVEY_ID）' };
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  try {
    const { tabs, fetchedAt } = await fetchSheetTabs(id);
    const responseTabs = tabs.filter((t) => detectSurveyColumns(t.rows) != null);
    if (responseTabs.length === 0) {
      return { status: 'unavailable', today, sheetUrl, reason: `「タイムスタンプ」見出しを持つタブが見つかりません（タブ数 ${tabs.length}）` };
    }
    const list = parseSurveyTabs(
      responseTabs.map((t) => t.rows),
      today,
    );
    return { status: 'ok', today, sheetUrl, fetchedAt, tabCount: tabs.length, responseTabCount: responseTabs.length, summary: summarizeSurvey(list, today) };
  } catch (e) {
    return { status: 'unavailable', today, sheetUrl, reason: e instanceof Error ? e.message : String(e) };
  }
}
