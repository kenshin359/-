// 表示フォーマット。MetricValue の na は理由をそのまま表示し、NaN/∞を出さない。
import type { MetricValue } from './types';

export function formatYen(v: number): string {
  return `¥${Math.round(v).toLocaleString('ja-JP')}`;
}

export function formatMetric(
  m: MetricValue,
  unit: '円' | '%' | '倍' | '件' | '個' = '円',
  digits = 1,
): string {
  if (m.kind === 'na') return m.reason;
  switch (unit) {
    case '円':
      return formatYen(m.value);
    case '%':
      return `${m.value.toFixed(digits)}%`;
    case '倍':
      return `${m.value.toFixed(digits)}倍`;
    default:
      return `${Math.round(m.value).toLocaleString('ja-JP')}${unit}`;
  }
}

/** JSTの暦日 YYYY-MM-DD（端末地域設定に依存しない） */
export function jstDateKey(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
