// ============================================================
//  楽天RMS「日次 店舗データ」を読む
// ------------------------------------------------------------
//  RMS → 店舗カルテ から落とせる、日ごとの店舗全体の数字です。
//  ファイル名の例: 20260701_20260731_日次_店舗データ.csv
//
//  このファイルのくせ:
//    ① 1〜3行目が注意書きと期間で、見出しは4行目にある
//    ② 1日が4行に分かれている（すべて / PC / スマートフォン / 楽天市場アプリ）
//       ★「すべて」以外も足すと、売上が約2倍になります。必ず絞ること。
//    ③ 商品別の内訳が入っていない（店舗全体の合計だけ）
//
//  ③のため、このファイルだけでは「どの商品が売れたか」は分かりません。
//  商品別が必要な場合は RMS の「商品別データ」を別途ダウンロードしてください。
//  ここでは分かる範囲（日ごとの売上・件数・アクセス・転換率）を返します。
// ============================================================
import { decodeText, parseCsv, normalizeHeader } from './csv.js';
import { parseAmount, parseDate } from './salesValues.js';

/** 「すべて」を表すデバイス名。これ以外の行は合計に含めない */
const TOTAL_DEVICE = ['すべて', '合計', '全体', 'total'];

const COL = {
  date: ['日付'],
  device: ['デバイス'],
  amount: ['売上金額'],
  orders: ['売上件数'],
  access: ['アクセス人数'],
  cvr: ['転換率'],
  aov: ['客単価'],
};

/** 見出しの行を探す（前に注意書きが何行あっても動くように） */
export function findHeaderRow(matrix, maxScan = 10) {
  for (let i = 0; i < Math.min(matrix.length, maxScan); i++) {
    const cells = matrix[i].map((c) => normalizeHeader(c));
    if (cells.includes('日付') && cells.includes('売上金額')) return i;
  }
  return -1;
}

/** このファイルが「日次 店舗データ」かどうか */
export function looksLikeStoreDaily(buf) {
  const { text } = decodeText(buf);
  const matrix = parseCsv(text.split(/\r?\n/).slice(0, 12).join('\n'));
  return findHeaderRow(matrix) >= 0;
}

/**
 * 日ごとの店舗合計を返す。
 * @returns {{ok, reason?, rows, encoding, skippedDeviceRows}}
 */
export function readStoreDaily(buf) {
  const { text, encoding } = decodeText(buf);
  const matrix = parseCsv(text);
  const h = findHeaderRow(matrix);
  if (h < 0) {
    return { ok: false, encoding, reason: '「日付」「売上金額」の見出しが見つかりません', rows: [] };
  }

  const headers = matrix[h].map((c) => normalizeHeader(c));
  const idx = {};
  for (const [key, names] of Object.entries(COL)) {
    idx[key] = headers.findIndex((c) => names.some((n) => c === normalizeHeader(n)));
  }
  if (idx.date < 0 || idx.amount < 0) {
    return { ok: false, encoding, reason: '日付か売上金額の列が見つかりません', rows: [] };
  }

  const rows = [];
  let skippedDeviceRows = 0;

  for (const cells of matrix.slice(h + 1)) {
    // ★デバイス別の行を足してはいけない（同じ売上を二重に数えることになる）
    if (idx.device >= 0) {
      const dev = String(cells[idx.device] ?? '').trim();
      if (!TOTAL_DEVICE.includes(dev)) {
        if (dev) skippedDeviceRows++;
        continue;
      }
    }
    const date = parseDate(cells[idx.date]);
    if (!date) continue;

    const pick = (k) => (idx[k] >= 0 ? parseAmount(cells[idx[k]]) : null);
    rows.push({
      date,
      amount: pick('amount') ?? 0,
      orders: pick('orders') ?? 0,
      access: pick('access') ?? 0,
      cvr: pick('cvr') ?? 0,
      aov: pick('aov') ?? 0,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, encoding, rows, skippedDeviceRows, hasProductBreakdown: false };
}

/** 取込ログ用の要約（何を読んだかを人が読める形で残す） */
export function summarizeStoreDaily(result) {
  const total = result.rows.reduce((s, r) => s + r.amount, 0);
  const orders = result.rows.reduce((s, r) => s + r.orders, 0);
  const access = result.rows.reduce((s, r) => s + r.access, 0);
  return {
    days: result.rows.length,
    total,
    orders,
    access,
    // 期間全体の転換率は「件数 ÷ アクセス」で出し直す（日ごとの平均ではない）
    cvr: access > 0 ? (orders / access) * 100 : 0,
    aov: orders > 0 ? total / orders : 0,
  };
}
