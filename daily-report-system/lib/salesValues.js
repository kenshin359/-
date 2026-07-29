// ============================================================
//  売上ファイルの「値」を読み取る（金額・日付・数量）
// ------------------------------------------------------------
//  管理画面ごとに書き方がバラバラなので、ここで揃えます。
//
//  金額の例:  1,234 / ¥1,234 / 1,234円 / JPY 1234 / 1234.00 / (1,234) / -1234
//  日付の例:  2026/07/29 / 2026-07-29 / 20260729 / 2026年7月29日
//            / 2026-07-29T13:45:00+09:00 / 07/29/2026
//
//  ★重要★ 金額の計算は必ずこの JS 側で行い、AIには渡しません。
//          （AIに大量の足し算をさせると数字がずれることがあるため）
// ============================================================

/**
 * 文字列を数値にする。読めなければ null。
 * 「-」「‐」「N/A」「未計上」などの空値表現も null 扱い。
 *
 * @param {string|number} raw
 * @returns {number|null}
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (s === '') return null;

  // 全角数字・全角記号を半角に
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９．，－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

  // 空値としてよく使われる表現
  if (/^(-|‐|—|ー|n\/a|na|null|なし|未計上|不明)$/i.test(s)) return null;

  // 会計表記の (1,234) は マイナス1234
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    s = paren[1];
  }

  // 通貨記号・単位・カンマ・空白を除去
  s = s
    .replace(/[¥￥$€]/g, '')
    .replace(/jpy|usd|円|件|点|個/gi, '')
    .replace(/[,\s]/g, '');

  if (s.startsWith('-') || s.startsWith('△') || s.startsWith('▲')) {
    negative = true;
    s = s.replace(/^[-△▲]/, '');
  }

  if (!/^\d*\.?\d+$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * 文字列から日付（YYYY-MM-DD）を取り出す。読めなければ null。
 * @param {string} raw
 * @returns {string|null}
 */
export function parseDate(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

  // 2026年7月29日
  let m = s.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return iso(m[1], m[2], m[3]);

  // 2026-07-29 / 2026/07/29 / 2026.07.29（後ろに時刻が付いていてもよい）
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);

  // 20260729
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(m[1], m[2], m[3]);

  // 07/29/2026（Amazon の英語レポートなど）
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return iso(m[3], m[1], m[2]);

  return null;
}

function iso(y, mo, d) {
  const mm = String(Number(mo)).padStart(2, '0');
  const dd = String(Number(d)).padStart(2, '0');
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mm}-${dd}`;
}

/** 金額を「¥1,234,567」の形にする */
export function yen(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}¥${Math.round(Math.abs(n)).toLocaleString('ja-JP')}`;
}

/** 増減率を「+8.2%」の形にする。前日が0なら「—」 */
export function deltaPct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** 増減率を表示用の文字にする */
export function formatDelta(pct) {
  if (pct === null) return '';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}
