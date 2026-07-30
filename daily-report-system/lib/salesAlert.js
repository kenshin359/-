// ============================================================
//  売上が記載されたときの通知文（分析つき）
// ------------------------------------------------------------
//  その日の数字だけでなく、
//  「普段と比べてどうだったか」まで書きます。
//
//  ★計算はすべてここ（JS側）で行います。AIは使いません。
//    金額がずれる心配がなく、費用もゼロです。
// ============================================================
import { yen, deltaPct, formatDelta } from './salesValues.js';

/** 直近N日の中央値（極端な日に引きずられない基準） */
function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pctMark(p) {
  if (p === null) return '';
  return p <= -15 ? ' ⚠️' : p >= 15 ? ' 🔺' : '';
}

/**
 * 通知文を組み立てる。
 *
 * @param {object[]} rows extractDailyRows の結果（日付昇順）
 * @param {string} dateISO 対象日
 */
export function buildSalesAlert(rows, dateISO) {
  const idx = rows.findIndex((r) => r.date === dateISO);
  const day = rows[idx];
  if (!day) throw new Error(`${dateISO} のデータがありません`);

  const prev = idx > 0 ? rows[idx - 1] : null;
  // 直近14日（当日を除く）を「普段」とみなす
  const recent = rows.slice(Math.max(0, idx - 14), idx);
  const med = median(recent.map((r) => r.sales.total).filter((v) => v));

  const total = day.sales.total ?? day.sales.rakuten + day.sales.amazon + day.sales.own;
  const dod = prev?.sales.total ? deltaPct(total, prev.sales.total) : null;
  const vsMed = med ? deltaPct(total, med) : null;

  // 販売個数
  const units = Object.values(day.units ?? {}).reduce(
    (s, ch) => s + Object.values(ch).reduce((a, b) => a + b, 0),
    0
  );

  const lines = [];
  lines.push(`💰 売上が記載されました（${dateISO}）`);
  lines.push('');
  lines.push(`合計　${yen(total)}`);
  lines.push(`　楽天 ${yen(day.sales.rakuten)}／Amazon ${yen(day.sales.amazon)}／自社 ${yen(day.sales.own)}`);
  if (units) lines.push(`販売個数　${units.toLocaleString('ja-JP')}個`);
  lines.push('');

  // ── 分析 ──
  lines.push('【分析】');
  if (dod !== null) {
    lines.push(`前日比　${formatDelta(dod)}${pctMark(dod)}（前日 ${yen(prev.sales.total)}）`);
  }
  if (vsMed !== null) {
    lines.push(`直近14日の中央値比　${formatDelta(vsMed)}${pctMark(vsMed)}（普段 ${yen(med)}）`);
  }

  // チャネルの偏り
  const sales = [
    ['楽天', day.sales.rakuten],
    ['Amazon', day.sales.amazon],
    ['自社サイト', day.sales.own],
  ].sort((a, b) => b[1] - a[1]);
  if (total > 0) {
    const [topName, topVal] = sales[0];
    lines.push(`最大チャネル　${topName}（${((topVal / total) * 100).toFixed(1)}%）`);
  }

  // 各チャネルの普段との比較（どこが伸びた/落ちたかを特定する）
  const notes = [];
  for (const [label, key] of [['楽天', 'rakuten'], ['Amazon', 'amazon'], ['自社サイト', 'own']]) {
    const chMed = median(recent.map((r) => r.sales[key]).filter((v) => v));
    if (!chMed) continue;
    const p = deltaPct(day.sales[key], chMed);
    if (p === null) continue;
    if (p <= -30) notes.push(`${label}が普段より${Math.abs(p).toFixed(0)}%少ない`);
    if (p >= 50) notes.push(`${label}が普段より${p.toFixed(0)}%多い`);
  }
  if (notes.length) {
    lines.push('');
    lines.push('【気づき】');
    for (const n of notes) lines.push(`・${n}`);
  }

  // アクセスと転換率（原因の切り分け）
  const rk = day.metrics?.rakuten ?? {};
  if (rk.access || rk.cvr) {
    lines.push('');
    lines.push('【楽天の集客と転換】');
    if (rk.access) lines.push(`アクセス数　${rk.access.toLocaleString('ja-JP')}`);
    if (rk.cvr) lines.push(`転換率　${rk.cvr}%`);
    if (rk.fav) lines.push(`お気に入り登録　${rk.fav.toLocaleString('ja-JP')}`);

    // 売上が落ちたとき、集客と転換のどちらが原因かを示す
    if (vsMed !== null && vsMed <= -15) {
      const accMed = median(recent.map((r) => r.metrics?.rakuten?.access).filter((v) => v));
      const cvrMed = median(recent.map((r) => r.metrics?.rakuten?.cvr).filter((v) => v));
      const accP = accMed && rk.access ? deltaPct(rk.access, accMed) : null;
      const cvrP = cvrMed && rk.cvr ? deltaPct(rk.cvr, cvrMed) : null;
      if (accP !== null && cvrP !== null) {
        lines.push('');
        const cause =
          accP <= -15 && cvrP > -15
            ? '集客（アクセス数）が落ちています'
            : cvrP <= -15 && accP > -15
              ? '転換率が落ちています（ページ・価格・在庫の確認を）'
              : accP <= -15 && cvrP <= -15
                ? '集客と転換の両方が落ちています'
                : '集客・転換とも普段の範囲です（単価や点数の影響かもしれません）';
        lines.push(`▶ 売上が落ちた原因の切り分け: ${cause}`);
      }
    }
  }

  lines.push('');
  lines.push('※ 添付の簡易シートに直近14日の推移が入っています。');

  return {
    date: dateISO,
    text: lines.join('\n').trim(),
    today: { total, units, ...day.sales },
    dod,
    vsMedian: vsMed,
    median: med,
    notes,
  };
}
