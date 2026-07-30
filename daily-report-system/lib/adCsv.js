// ============================================================
//  各広告媒体の CSV を、共通の形に読み替える
// ------------------------------------------------------------
//  対応: Meta広告 / Amazon広告 / RPP(楽天) / Google広告 / TikTok広告
//
//  媒体ごとに見出しがバラバラなので、ここで1本に揃えます。
//  揃えたあとの形（1行 = 1キャンペーンの実績）:
//    { media, dateStart, dateEnd, days, campaign,
//      cost, impressions, clicks, conversions, revenue }
//
//  ★数字はすべてこの JS で読み取ります。AIには渡しません。
//    金額がずれる心配がなく、費用もゼロです。
//
//  ★注意★ Meta の「結果」列は、多くの場合クリック数であって
//    注文数ではありません（結果インジケーターが actions:link_click 等）。
//    そのまま注文数として扱うと CPA を大きく間違えるため、
//    購入を指すときだけ注文数として採用します。
// ============================================================
import { readTable, normalizeHeader } from './csv.js';
import { parseAmount, parseDate } from './salesValues.js';

export const MEDIA = {
  META: 'Meta広告',
  AMAZON: 'Amazon広告',
  RPP: 'RPP(楽天)',
  GOOGLE: 'Google広告',
  TIKTOK: 'TikTok広告',
  OTHER: 'その他',
};

/** 見出しの候補（正規化済み・小文字）。上から順に探して最初に見つかったものを使う */
const COLUMNS = {
  dateStart: ['reportingstarts', 'レポート開始日', '開始日', 'startdate', 'date', '日付', '日', 'day'],
  dateEnd: ['reportingends', 'レポート終了日', '終了日', 'enddate'],
  campaign: ['campaignname', 'キャンペーン名', 'campaign', 'キャンペーン', '広告グループ名', 'adgroupname'],
  cost: [
    'amountspent(jpy)', 'amountspent', '消化金額(jpy)', '消化金額',
    'spend', '支出', '広告費', 'cost', '費用', 'コスト',
    '実績額', 'クリック課金額', '課金額', '利用金額',
  ],
  impressions: ['impressions', 'インプレッション数', 'インプレッション', '表示回数', 'imp'],
  clicks: ['linkclicks', 'リンククリック(ユニーク)', 'リンククリック', 'clicks', 'クリック数', 'クリック'],
  conversions: ['orders', '注文数', 'conversions', 'コンバージョン数', '購入数', '成果数', 'purchases'],
  revenue: [
    '7daytotalsales', '7daytotalsales(jpy)', 'sales', '売上', '売上金額',
    'conversionvalue', '広告経由売上', 'totalsales', 'revenue',
  ],
  // Meta 専用（「結果」が何の結果かを示す列）
  metaResults: ['results', '結果'],
  metaResultIndicator: ['resultindicator', '結果インジケーター'],
};

/** 見出しの一覧から、欲しい列の実際の見出し名を探す */
export function pickHeader(headers, candidates) {
  const norm = headers.map((h) => normalizeHeader(h));
  for (const c of candidates) {
    const key = normalizeHeader(c);
    const i = norm.indexOf(key);
    if (i >= 0) return headers[i];
  }
  // 完全一致で見つからなければ部分一致（「消化金額 (JPY)」のような表記ゆれ対策）
  for (const c of candidates) {
    const key = normalizeHeader(c);
    const i = norm.findIndex((h) => h.includes(key));
    if (i >= 0) return headers[i];
  }
  return null;
}

/**
 * 見出しとファイル名から媒体を推定する。
 * 分からなければ null を返す（呼び出し側で --media= を指定してもらう）。
 */
export function detectMedia(headers, filename = '') {
  const norm = headers.map((h) => normalizeHeader(h)).join('|');
  const f = String(filename).toLowerCase();

  // Meta は「アトリビューション設定」列が必ず付く
  if (norm.includes('アトリビューション設定') || norm.includes('attributionsetting')) return MEDIA.META;
  if (norm.includes('広告セットの予算') || norm.includes('adsetbudget')) return MEDIA.META;

  if (norm.includes('portfolioname') || norm.includes('ポートフォリオ名')) return MEDIA.AMAZON;
  if (norm.includes('advertisedasin') || norm.includes('広告対象asin')) return MEDIA.AMAZON;

  if (norm.includes('実績額') || norm.includes('rpp')) return MEDIA.RPP;

  if (norm.includes('広告費用対効果') && norm.includes('インプレッション')) return MEDIA.GOOGLE;
  if (norm.includes('costmicros')) return MEDIA.GOOGLE;

  if (norm.includes('tiktok')) return MEDIA.TIKTOK;

  // 見出しで分からなければファイル名で判断
  if (/meta|facebook|fb_/.test(f)) return MEDIA.META;
  if (/amazon|sponsored/.test(f)) return MEDIA.AMAZON;
  if (/rpp|rakuten/.test(f)) return MEDIA.RPP;
  if (/google|adwords/.test(f)) return MEDIA.GOOGLE;
  if (/tiktok|tt_/.test(f)) return MEDIA.TIKTOK;

  return null;
}

/** Meta の「結果」を注文数として使ってよいか判定する */
export function isPurchaseIndicator(indicator) {
  const s = String(indicator ?? '').toLowerCase();
  if (!s) return false;
  return s.includes('purchase') || s.includes('購入') || s.includes('offsite_conversion.fb_pixel_purchase');
}

/**
 * 広告CSVを共通の形にする。
 *
 * @param {Buffer|Uint8Array} buf ファイルの中身
 * @param {object} opts { media, filename }
 * @returns {{media, rows, skipped, headers, encoding, periodStart, periodEnd, isDaily}}
 */
export function readAdFile(buf, opts = {}) {
  const { headers, rows, encoding } = readTable(buf);
  const media = opts.media || detectMedia(headers, opts.filename) || MEDIA.OTHER;

  const col = {};
  for (const [key, candidates] of Object.entries(COLUMNS)) {
    col[key] = pickHeader(headers, candidates);
  }

  const out = [];
  const skipped = [];

  for (const r of rows) {
    const campaign = col.campaign ? String(r[col.campaign] ?? '').trim() : '';
    const cost = col.cost ? parseAmount(r[col.cost]) : null;

    // 金額が読めない行は捨てる（合計行・空行・注記行など）
    if (cost === null) {
      if (campaign) skipped.push({ campaign, reason: '広告費が読み取れません' });
      continue;
    }

    const dateStart = col.dateStart ? parseDate(r[col.dateStart]) : null;
    const dateEnd = col.dateEnd ? parseDate(r[col.dateEnd]) : dateStart;

    let conversions = col.conversions ? parseAmount(r[col.conversions]) : null;
    // Meta の「結果」は購入を指すときだけ注文数として使う
    if (conversions === null && media === MEDIA.META && col.metaResults) {
      const indicator = col.metaResultIndicator ? r[col.metaResultIndicator] : '';
      if (isPurchaseIndicator(indicator)) conversions = parseAmount(r[col.metaResults]);
    }

    out.push({
      media,
      campaign,
      dateStart,
      dateEnd: dateEnd ?? dateStart,
      days: countDays(dateStart, dateEnd ?? dateStart),
      cost,
      impressions: col.impressions ? parseAmount(r[col.impressions]) : null,
      clicks: col.clicks ? parseAmount(r[col.clicks]) : null,
      conversions,
      revenue: col.revenue ? parseAmount(r[col.revenue]) : null,
    });
  }

  const starts = out.map((r) => r.dateStart).filter(Boolean).sort();
  const ends = out.map((r) => r.dateEnd).filter(Boolean).sort();
  const periodStart = starts[0] ?? null;
  const periodEnd = ends[ends.length - 1] ?? null;

  return {
    media,
    headers,
    encoding,
    rows: out,
    skipped,
    periodStart,
    periodEnd,
    // 1日分だけのファイルか（期間まとめのファイルは日別に割り振れない）
    isDaily: !!periodStart && periodStart === periodEnd,
  };
}

/** 開始日〜終了日の日数（両端を含む）。読めなければ null */
export function countDays(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const a = Date.parse(`${startISO}T00:00:00Z`);
  const b = Date.parse(`${endISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}
