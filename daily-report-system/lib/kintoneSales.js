// ============================================================
//  Kintone「売上・転換率報告」アプリ（ID 7）の読み取り
// ------------------------------------------------------------
//  このアプリの構造（実データで確認済み）:
//
//   ・1レコード ＝ 1ヶ月（「7月売り上げ報告」など）
//   ・1日分の報告が、複数行テキストのフィールド1つに入っている
//   ・フィールドは日付の降順に並んでいる
//     （番号が小さいほど新しい日。#17=7/28, #18=7/27, ...）
//   ・本文は【売り上げ】【ランキング】【詳細数値】の決まった形式
//
//  ※ Kintone は読むだけ。一切変更しません。
// ============================================================
import { optional } from './env.js';
import { authHeadersFor } from './kintone.js';
import { fetchWithRetry } from './httpRetry.js';
import { parseReport } from '../../src/parseReport.js';

/** 売上アプリのID（既定 7） */
export function salesAppId() {
  return optional('KINTONE_SALES_APP_ID', '7');
}

function baseUrl() {
  return (optional('KINTONE_BASE_URL') || '').replace(/\/$/, '');
}

/**
 * 売上アプリの全レコードを取得する。
 * 月ごとに1レコードなので件数は少なく、ページングは不要。
 */
export async function fetchSalesRecords() {
  const url = `${baseUrl()}/k/v1/records.json?app=${encodeURIComponent(salesAppId())}`;
  // ★GET に Content-Type を付けると kintone は 400 を返すため付けない
  const res = await fetchWithRetry(
    url,
    { method: 'GET', headers: authHeadersFor(null) },
    { label: 'kintone 売上アプリ取得' }
  );
  return res.json?.records ?? [];
}

/** フィールドコード末尾の数字を取り出す（並び順の判定に使う） */
function fieldOrder(code) {
  const m = code.match(/_(\d+)$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * レコード群から「1日1件」の売上データに展開する。
 *
 * @param {object[]} records
 * @returns {object[]} { date, total, rakuten, amazon, own, metrics, ranking,
 *                       recordId, monthLabel, order, raw }
 */
export function extractDailySales(records) {
  const rows = [];

  for (const rec of records) {
    const recordId = rec.$id?.value;
    const monthLabel = rec['文字列__1行_']?.value ?? '';

    for (const [code, field] of Object.entries(rec)) {
      if (field?.type !== 'MULTI_LINE_TEXT') continue;
      const text = field.value;
      if (!text || !text.trim()) continue;

      const parsed = parseReport(text);
      if (!parsed || !parsed.date) continue;
      // 合計が読めない本文（転換率だけの補足など）は売上行として扱わない
      if (parsed.sales.total === null || parsed.sales.total === undefined) continue;

      rows.push({
        date: parsed.date,
        total: parsed.sales.total,
        rakuten: parsed.sales.rakuten ?? 0,
        amazon: parsed.sales.amazon ?? 0,
        own: parsed.sales.own ?? 0,
        metrics: parsed.metrics,
        ranking: parsed.ranking,
        recordId,
        monthLabel,
        order: fieldOrder(code),
        fieldCode: code,
      });
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
}

/**
 * 日付の記入ミスを検出する。
 *
 * このアプリはフィールドが日付の降順に並ぶため、
 * 「番号が大きいのに日付が新しい」行は記入ミスの疑いが強い。
 * 実データでは、前日の報告をコピーして日付を直し忘れた例が見つかった。
 *
 * ★自動で直さず、報告するだけにしている。
 *   売上金額そのものは正しいため、勝手に日付を書き換える方が危険なため。
 *
 * @param {object[]} rows extractDailySales の結果
 * @returns {object[]} { type, date, detail }
 */
export function findDateIssues(rows) {
  const issues = [];

  // ① 同じ日付が複数ある（金額が違えば別の日の可能性が高い）
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  for (const [date, list] of byDate) {
    if (list.length > 1) {
      issues.push({
        type: 'duplicate',
        date,
        count: list.length,
        detail: `${date} の報告が${list.length}件あります（金額: ${list
          .map((r) => `¥${r.total.toLocaleString('ja-JP')}`)
          .join(' / ')}）`,
      });
    }
  }

  // ② 月内で欠けている日
  const months = new Map();
  for (const r of rows) {
    const ym = r.date.slice(0, 7);
    if (!months.has(ym)) months.set(ym, new Set());
    months.get(ym).add(r.date);
  }
  for (const [ym, dates] of months) {
    const sorted = [...dates].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const missing = [];
    for (let d = new Date(first + 'T00:00:00Z'); d <= new Date(last + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (!dates.has(iso)) missing.push(iso);
    }
    if (missing.length) {
      issues.push({
        type: 'missing',
        date: ym,
        count: missing.length,
        detail: `${ym} で報告が無い日: ${missing.map((m) => m.slice(5)).join(', ')}`,
      });
    }
  }

  return issues;
}

/** 指定月（YYYY-MM）の行だけを取り出す */
export function filterByMonth(rows, ym) {
  return rows.filter((r) => r.date.startsWith(ym));
}

/** データがある最新の月（YYYY-MM）を返す */
export function latestMonth(rows) {
  if (!rows.length) return null;
  return rows[rows.length - 1].date.slice(0, 7);
}
