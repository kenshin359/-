// ============================================================
//  日付ヘルパー（タイムゾーン対応）
// ------------------------------------------------------------
//  REPORT_TIMEZONE（既定 Asia/Tokyo）における「今日」を YYYY-MM-DD で得る。
//  Intl を使うので追加パッケージ不要。
// ============================================================
import { optional } from './env.js';

/**
 * 指定タイムゾーンでの日付を 'YYYY-MM-DD' で返す。
 * @param {Date} [d=now]
 */
export function todayISO(d = new Date()) {
  const tz = optional('REPORT_TIMEZONE', 'Asia/Tokyo');
  // en-CA ロケールは YYYY-MM-DD 形式で返る
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** 引数 --date=YYYY-MM-DD があればそれを、無ければ今日を返す */
export function resolveTargetDate(argv = process.argv) {
  const arg = argv.find((a) => a.startsWith('--date='));
  if (arg) {
    const v = arg.slice('--date='.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`--date は YYYY-MM-DD 形式で: ${v}`);
    return v;
  }
  return todayISO();
}
