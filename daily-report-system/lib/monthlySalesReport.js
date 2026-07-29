// ============================================================
//  月次売上レポートの組み立て
// ------------------------------------------------------------
//  Kintone の売上報告（文章）から集計した数字をもとに、
//  経営者が30秒で読めるレポートを作ります。
//
//   ・総売上（当月累計）
//   ・昨日の売上
//   ・前日比
//   ・前月比
//   ・イベントの有無（※下記の注意を参照）
//
//  ★イベントについて★
//  Kintone の売上報告にはイベント（セール等）の記載がありません。
//  そのため「売上が普段より大きく伸びた日」を数字から拾い、
//  **推定**として提示します。断定はしません。
//  正確に出すには、イベント予定表を別途持つ必要があります。
//
//  ★計算はすべてこのJS側で行います。AIには渡しません。
// ============================================================
import { yen, deltaPct, formatDelta } from './salesValues.js';

/** 中央値（極端な日に引きずられない基準値として使う） */
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 前月の YYYY-MM を返す */
export function previousMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 前日の YYYY-MM-DD を返す */
export function previousDay(dateISO) {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 同じ日付が複数ある場合は合算せず「合計」として1件にまとめる */
function sumByDate(rows) {
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.date) || { date: r.date, total: 0, rakuten: 0, amazon: 0, own: 0, count: 0 };
    cur.total += r.total;
    cur.rakuten += r.rakuten;
    cur.amazon += r.amazon;
    cur.own += r.own;
    cur.count += 1;
    map.set(r.date, cur);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function totals(days) {
  return days.reduce(
    (s, d) => ({
      total: s.total + d.total,
      rakuten: s.rakuten + d.rakuten,
      amazon: s.amazon + d.amazon,
      own: s.own + d.own,
    }),
    { total: 0, rakuten: 0, amazon: 0, own: 0 }
  );
}

/**
 * 月次レポートのデータを組み立てる。
 *
 * @param {object[]} rows lib/kintoneSales.js の extractDailySales の結果
 * @param {string} todayISO 今日の日付（YYYY-MM-DD）
 * @param {object} [opts] { spikeRatio: 急伸とみなす倍率（既定1.5） }
 */
export function buildMonthlySalesReport(rows, todayISO, opts = {}) {
  const spikeRatio = opts.spikeRatio ?? 1.5;

  const ym = todayISO.slice(0, 7);
  const prevYm = previousMonth(ym);

  const thisMonthDays = sumByDate(rows.filter((r) => r.date.startsWith(ym)));
  const prevMonthDays = sumByDate(rows.filter((r) => r.date.startsWith(prevYm)));

  const thisTotals = totals(thisMonthDays);
  const prevTotals = totals(prevMonthDays);

  // ── 昨日と一昨日 ──
  const yesterdayISO = previousDay(todayISO);
  const dayBeforeISO = previousDay(yesterdayISO);
  const yesterday = thisMonthDays.find((d) => d.date === yesterdayISO) ?? null;
  const dayBefore =
    thisMonthDays.find((d) => d.date === dayBeforeISO) ??
    prevMonthDays.find((d) => d.date === dayBeforeISO) ??
    null;

  // ── 前日比 ──
  const dod = yesterday && dayBefore ? deltaPct(yesterday.total, dayBefore.total) : null;

  // ── 前月比 ──
  // 記録日数が月によって違うため、単純な累計比較は誤解を招く。
  // 「日商平均」での比較を主とし、累計比較は参考として併記する。
  const thisAvg = thisMonthDays.length ? thisTotals.total / thisMonthDays.length : null;
  const prevAvg = prevMonthDays.length ? prevTotals.total / prevMonthDays.length : null;
  const momAvg = thisAvg !== null && prevAvg !== null ? deltaPct(thisAvg, prevAvg) : null;
  const momTotal = prevTotals.total > 0 ? deltaPct(thisTotals.total, prevTotals.total) : null;

  // ── イベント（推定）──
  // 中央値の spikeRatio 倍を超えた日を「普段と違う動きがあった日」とみなす。
  //
  // ★同じ日付の報告が複数ある日（count > 1）は除外する。
  //   日付の書き間違いで2日分が1日に合算されている可能性が高く、
  //   そのままだと「イベントがあった日」として誤って報告してしまうため。
  //   これらは【要確認】側で別途知らせる。
  const reliableDays = thisMonthDays.filter((d) => d.count === 1);
  const med = median(reliableDays.map((d) => d.total));
  const spikes = med
    ? reliableDays
        .filter((d) => d.total >= med * spikeRatio)
        .map((d) => ({ ...d, ratio: d.total / med }))
        .sort((a, b) => b.total - a.total)
    : [];
  const yesterdayIsSpike = !!(yesterday && yesterday.count === 1 && med && yesterday.total >= med * spikeRatio);

  return {
    month: ym,
    prevMonth: prevYm,
    today: todayISO,
    days: thisMonthDays,
    dayCount: thisMonthDays.length,
    prevDayCount: prevMonthDays.length,
    totals: thisTotals,
    prevTotals,
    average: thisAvg,
    prevAverage: prevAvg,
    yesterday,
    yesterdayISO,
    dayBefore,
    dayBeforeISO,
    dod,
    momAvg,
    momTotal,
    median: med,
    spikes,
    yesterdayIsSpike,
    // 日付が重複していて日次の数字が信頼できない日
    unreliableDays: thisMonthDays.filter((d) => d.count > 1),
    // 前月のデータが月初から揃っているか（揃っていなければ前月比は参考値）
    prevMonthCoversFullMonth: prevMonthDays.length > 0 && prevMonthDays[0].date.endsWith('-01'),
  };
}

function pctLine(pct) {
  if (pct === null) return '—';
  const mark = pct <= -10 ? ' ⚠️' : pct >= 10 ? ' 🔺' : '';
  return `${formatDelta(pct)}${mark}`;
}

/**
 * レポートを通知用の文面にする。
 * @param {object} rep buildMonthlySalesReport の結果
 * @param {object} [opts] { issues: 日付の記入ミス等, comment: AIコメント }
 */
export function formatMonthlySalesReport(rep, opts = {}) {
  const out = [];
  const [y, m] = rep.month.split('-');

  out.push(`📊 ${Number(m)}月 売上レポート（${rep.today} 時点）`);
  out.push('');

  // ── 総売上 ──
  out.push('【総売上】');
  out.push(`${Number(m)}月累計　${yen(rep.totals.total)}　（${rep.dayCount}日分）`);
  if (rep.average) out.push(`日商平均　${yen(rep.average)}`);
  out.push(`　楽天 ${yen(rep.totals.rakuten)}／Amazon ${yen(rep.totals.amazon)}／自社 ${yen(rep.totals.own)}`);
  out.push('');

  // ── 昨日 ──
  out.push('【昨日の売上】');
  if (rep.yesterday) {
    out.push(`${rep.yesterdayISO}　${yen(rep.yesterday.total)}`);
    out.push(
      `　楽天 ${yen(rep.yesterday.rakuten)}／Amazon ${yen(rep.yesterday.amazon)}／自社 ${yen(rep.yesterday.own)}`
    );
  } else {
    out.push(`${rep.yesterdayISO}　報告がまだ登録されていません`);
  }
  out.push('');

  // ── 前日比 ──
  out.push('【前日比】');
  if (rep.dod !== null) {
    out.push(`${pctLine(rep.dod)}　（前日 ${rep.dayBeforeISO}: ${yen(rep.dayBefore.total)}）`);
  } else {
    out.push('比較できる前日のデータがありません');
  }
  out.push('');

  // ── 前月比 ──
  out.push('【前月比】');
  if (rep.momAvg !== null) {
    const [, pm] = rep.prevMonth.split('-');
    out.push(`日商平均　${pctLine(rep.momAvg)}　（${Number(pm)}月 ${yen(rep.prevAverage)} → ${Number(m)}月 ${yen(rep.average)}）`);
    out.push(`累計　　　${yen(rep.prevTotals.total)}（${rep.prevDayCount}日分） → ${yen(rep.totals.total)}（${rep.dayCount}日分）`);
    if (!rep.prevMonthCoversFullMonth) {
      out.push(`　※ ${Number(pm)}月は${rep.prevDayCount}日分しか登録が無いため、累計の単純比較はできません。`);
      out.push('　　日商平均での比較をご覧ください。');
    }
  } else {
    out.push('前月のデータがありません');
  }
  out.push('');

  // ── イベント（推定）──
  out.push('【イベントの有無】');
  if (rep.yesterdayIsSpike && rep.yesterday) {
    out.push(`昨日は平常時の${(rep.yesterday.total / rep.median).toFixed(1)}倍。イベント・施策があった可能性があります。`);
  } else if (rep.yesterday) {
    out.push('昨日は平常の範囲内でした。');
  }
  if (rep.spikes.length) {
    out.push(`${Number(m)}月に大きく伸びた日:`);
    for (const s of rep.spikes.slice(0, 5)) {
      out.push(`・${s.date.slice(5)}　${yen(s.total)}（平常の${s.ratio.toFixed(1)}倍）`);
    }
  } else {
    out.push(`${Number(m)}月に突出した日はありません。`);
  }
  if (rep.unreliableDays?.length) {
    out.push(
      `　※ ${rep.unreliableDays.map((d) => d.date.slice(5)).join('・')} は報告が重複しており、` +
        '日次の数字が正しくないため判定から除外しています。'
    );
  }
  out.push('　※ Kintoneにイベント情報が無いため、売上の動きからの推定です。');
  out.push('');

  // ── AIコメント（任意）──
  if (opts.comment && opts.comment !== '特記事項なし') {
    out.push(`💡 ${opts.comment}`);
    out.push('');
  }

  // ── データの問題 ──
  if (opts.issues?.length) {
    out.push('【要確認：データの記入について】');
    for (const i of opts.issues) out.push(`・${i.detail}`);
  }

  return out.join('\n').trim();
}
