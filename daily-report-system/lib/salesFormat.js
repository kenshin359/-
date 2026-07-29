// ============================================================
//  売上サマリーを「通知の文面」にする
// ------------------------------------------------------------
//  経営者が30秒で読めることを最優先にしています。
//   1行目 … 総売上と前日比
//   次    … 媒体ごとの内訳
//   次    … 広告費と ROAS
//   最後  … 売れ筋 と 注意点
//
//  ここには AI を使いません（費用ゼロ）。
//  AIコメントを足したい場合だけ、末尾に1行差し込みます。
// ============================================================
import { yen, deltaPct, formatDelta } from './salesValues.js';

/** 前日比の矢印。大きく落ちたときだけ警告マークを付ける */
function trend(pct) {
  if (pct === null) return '';
  if (pct <= -10) return ' ⚠️';
  if (pct >= 10) return ' 🔺';
  return '';
}

function line(label, value, pct) {
  const d = pct === null || pct === undefined ? '' : `（前日比 ${formatDelta(pct)}）${trend(pct)}`;
  return `${label}　${value}${d}`;
}

/**
 * @param {object} summary buildDailySummary の結果
 * @param {object} [opts] { comment: AIコメント（任意）, title }
 * @returns {string}
 */
export function formatSalesSummary(summary, opts = {}) {
  const t = summary.totals;
  const out = [];

  out.push(`${opts.title || '💰 売上速報'}（${summary.date}）`);
  out.push('');

  // ── 全体 ──
  const revPct = t.prevRevenue === null ? null : deltaPct(t.revenue, t.prevRevenue);
  out.push(line('総売上', yen(t.revenue), revPct));
  out.push(`注文数　${t.orders.toLocaleString('ja-JP')}件` + (t.aov ? `　客単価 ${yen(t.aov)}` : ''));
  out.push('');

  // ── 媒体別 ──
  if (summary.salesChannels.length) {
    out.push('【媒体別】');
    const sorted = [...summary.salesChannels].sort((a, b) => b.revenue - a.revenue);
    for (const c of sorted) {
      if (!c.hasData) {
        out.push(`${c.label}　データなし`);
        continue;
      }
      const pct = c.prevRevenue === null ? null : deltaPct(c.revenue, c.prevRevenue);
      out.push(line(c.label, yen(c.revenue), pct));
    }
    out.push('');
  }

  // ── 広告 ──
  if (summary.adChannels.length) {
    out.push('【広告】');
    for (const c of summary.adChannels) {
      if (!c.hasData) {
        out.push(`${c.label}　データなし`);
        continue;
      }
      const pct = c.prevCost === null ? null : deltaPct(c.cost, c.prevCost);
      out.push(line(c.label, yen(c.cost), pct));
    }
    out.push(`広告費計　${yen(t.adCost)}`);
    if (t.roas !== null) {
      const warn = t.roas < 2 ? ' ⚠️' : '';
      out.push(`ROAS　${t.roas.toFixed(2)}${warn}　（広告費率 ${t.adRatio.toFixed(1)}%）`);
    }
    out.push('');
  }

  // ── 売れ筋 ──
  if (summary.topProducts.length) {
    out.push('【売れ筋 TOP3】');
    for (const p of summary.topProducts.slice(0, 3)) {
      const units = p.units ? `　${p.units}点` : '';
      out.push(`・${p.name}　${yen(p.revenue)}${units}`);
    }
    out.push('');
  }

  // ── AIコメント（任意・設定でOFFにできる） ──
  if (opts.comment && opts.comment !== '特記事項なし') {
    out.push(`💡 ${opts.comment}`);
    out.push('');
  }

  // ── 読み込めなかったファイル ──
  if (summary.problems?.length) {
    out.push('【要確認】');
    for (const p of summary.problems) {
      out.push(`・${p.fileName}: ${p.reason}`);
    }
  }

  return out.join('\n').trim();
}
