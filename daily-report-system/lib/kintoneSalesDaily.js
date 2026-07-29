// ============================================================
//  売上アプリ（ID 7）を「1日1件」の完全なデータに展開する
// ------------------------------------------------------------
//  このアプリは1レコード＝1ヶ月で、1日分が
//    「日付」＋「売り上げ報告」＋「転換率報告」＋「売上個数報告」
//  の4フィールドで1組になっています。
//
//  ★組み合わせはフォームのレイアウト（行）から判定します。
//    フィールドコードの番号は組ごとにバラバラで当てにならないためです。
//
//  ★日付は DATE型の「日付」フィールドを正とします。
//    本文の1行目にも日付が書かれていますが、前日分をコピーして
//    直し忘れた例が実データで見つかったため、そちらは検証用に留めます。
//
//  ※ Kintone は読むだけ。一切変更しません。
// ============================================================
import { optional } from './env.js';
import { authHeadersFor } from './kintone.js';
import { fetchWithRetry } from './httpRetry.js';
import { parseReport } from '../../src/parseReport.js';
import { parseUnitsReport, parseConversionReport } from './parseSalesDetail.js';

export function salesAppId() {
  return optional('KINTONE_SALES_APP_ID', '7');
}

function baseUrl() {
  return (optional('KINTONE_BASE_URL') || '').replace(/\/$/, '');
}

// ★GET に Content-Type を付けると kintone は 400 を返すため付けない
async function get(path) {
  const res = await fetchWithRetry(
    `${baseUrl()}${path}`,
    { method: 'GET', headers: authHeadersFor(null) },
    { label: `kintone GET ${path}` }
  );
  return res.json ?? {};
}

/** アプリのレイアウト・フィールド定義・レコードをまとめて取得する */
export async function fetchSalesApp() {
  const app = encodeURIComponent(salesAppId());
  const [layout, fields, records] = await Promise.all([
    get(`/k/v1/app/form/layout.json?app=${app}`),
    get(`/k/v1/app/form/fields.json?app=${app}`),
    get(`/k/v1/records.json?app=${app}`),
  ]);
  return { layout: layout.layout ?? [], fields: fields.properties ?? {}, records: records.records ?? [] };
}

/**
 * レイアウトから「1日分の組」を取り出す。
 * 1行に 日付 / 売り上げ報告 / 転換率報告 / 売上個数報告 が並んでいる。
 *
 * @returns {object[]} { date, sales, conversion, units } … 各値はフィールドコード
 */
export function buildDaySlots(layout, fields) {
  const label = (code) => fields[code]?.label ?? '';
  const slots = [];

  const walk = (rows) => {
    for (const row of rows) {
      if (row.type === 'GROUP') {
        walk(row.layout ?? []);
        continue;
      }
      if (row.type !== 'ROW') continue;

      const slot = {};
      for (const f of row.fields ?? []) {
        const code = f.code;
        if (!code) continue;
        switch (label(code)) {
          case '日付':
            slot.date = code;
            break;
          case '売り上げ報告':
            slot.sales = code;
            break;
          case '転換率報告':
            slot.conversion = code;
            break;
          case '売上個数報告':
            slot.units = code;
            break;
        }
      }
      // 日付と売上本文の両方がある行だけを「1日分」とみなす
      if (slot.date && slot.sales) slots.push(slot);
    }
  };

  walk(layout);
  return slots;
}

/**
 * レコード群を「1日1件」の完全なデータに展開する。
 *
 * @returns {object[]} 日付昇順。各要素:
 *   { date, monthLabel, recordId,
 *     sales: {rakuten, amazon, own, total},
 *     metrics: {rakuten:{access,cvr,fav,stay}, amazon:{access,cvr}},
 *     ranking: [{mall, product, rank, outOfRank}],
 *     units:   {rakuten:{商品:個数}, amazon:{...}, shopify, tiktok},
 *     unitTotals: {商品:個数},
 *     productCvr: {rakuten:{商品:%}, amazon:{...}},
 *     textDate, dateMismatch }
 */
export function extractDailyRows({ layout, fields, records }) {
  const slots = buildDaySlots(layout, fields);
  const rows = [];

  for (const rec of records) {
    const recordId = rec.$id?.value;
    const monthLabel = rec['文字列__1行_']?.value ?? '';

    for (const slot of slots) {
      const date = rec[slot.date]?.value;
      const salesText = rec[slot.sales]?.value;
      if (!date || !salesText || !salesText.trim()) continue;

      const parsed = parseReport(salesText);
      if (!parsed) continue;

      const unitsText = slot.units ? rec[slot.units]?.value : null;
      const cvrText = slot.conversion ? rec[slot.conversion]?.value : null;
      const u = unitsText ? parseUnitsReport(unitsText) : null;
      const c = cvrText ? parseConversionReport(cvrText) : null;

      rows.push({
        date,
        monthLabel,
        recordId,
        sales: {
          rakuten: parsed.sales.rakuten ?? 0,
          amazon: parsed.sales.amazon ?? 0,
          own: parsed.sales.own ?? 0,
          total: parsed.sales.total ?? null,
        },
        metrics: parsed.metrics,
        ranking: parsed.ranking ?? [],
        units: u?.units ?? {},
        unitTotals: u?.totals ?? {},
        productCvr: c?.cvr ?? {},
        // 本文に書かれた日付。DATE型と食い違えば記入ミスの疑い。
        textDate: parsed.date,
        dateMismatch: !!(parsed.date && parsed.date !== date),
      });
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** 日付の記入ミス（本文とDATE型の食い違い）を一覧にする */
export function findTextDateMismatches(rows) {
  return rows
    .filter((r) => r.dateMismatch)
    .map((r) => ({
      date: r.date,
      textDate: r.textDate,
      detail: `${r.date} の報告本文に「${r.textDate}」と書かれています（本文の書き間違いと思われます）`,
    }));
}
