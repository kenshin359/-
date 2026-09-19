// イベントカレンダー（月間目標＋イベント日の重み）の取得。
// 実体は朝礼と同じ daily-report-system/config/chorei/events-YYYY-MM.json のコピー
// （`sh scripts/sync-events.sh` で更新）。カレンダーが無い月は null を返し、画面は「未設定」を出す。
import { EVENT_CALENDARS } from '@/data/events';
import { parseEventCalendar, type EventCalendar } from './metrics/daily-target';

export function getEventCalendar(month: string): EventCalendar | null {
  const raw = EVENT_CALENDARS[month];
  if (!raw) return null;
  return parseEventCalendar(raw);
}

/** カレンダーがある月（新しい順） */
export function eventCalendarMonths(): string[] {
  return Object.keys(EVENT_CALENDARS).sort().reverse();
}
