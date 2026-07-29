// ============================================================
//  売上報告の「販売個数」「商品別転換率」を読み取る
// ------------------------------------------------------------
//  Kintone 売上・転換率報告アプリ（ID 7）の本文形式に対応します。
//  実データで確認した形式:
//
//  ── 売上個数報告 ──
//    🔸7/25(土)販売個数
//    ———————————-
//    🔸楽天
//    ・スーツケースS：63個
//    ・首振り：184個
//
//    🔸Amazon
//    ・スーツケースS：3個
//
//    🔸Shopify / 🔸tiktokshop も同じ形
//    ———————————-
//    合計
//    スーツケースS：69個      ← 「・」が付かない
//
//  ── 転換率報告 ──
//    【商品別転換率】
//    ▪️楽天
//    多機能PC(No.1)：0.32%
//    ▪️Amazon
//    多機能PC：1.43%
//
//  ★数値の集計はすべてこのJS側で行い、AIには渡しません。
// ============================================================

/** 販売チャネル名の表記ゆれをまとめる */
const CHANNEL_ALIASES = [
  { key: 'rakuten', label: '楽天', patterns: [/^楽天/] },
  { key: 'amazon', label: 'Amazon', patterns: [/^amazon/i, /^アマゾン/] },
  { key: 'shopify', label: 'Shopify', patterns: [/^shopify/i, /^自社/] },
  { key: 'tiktok', label: 'TikTok Shop', patterns: [/^tiktok/i] },
  { key: 'qoo10', label: 'Qoo10', patterns: [/^qoo10/i] },
  { key: 'yahoo', label: 'Yahoo', patterns: [/^yahoo/i, /^ヤフー/] },
];

/** チャネル見出しの文字列を正規化する。該当しなければ null */
export function normalizeChannel(raw) {
  const s = String(raw ?? '')
    .replace(/[🔸🔹▪️■◾️●・\s]/g, '')
    .trim();
  if (!s) return null;
  for (const c of CHANNEL_ALIASES) {
    if (c.patterns.some((p) => p.test(s))) return { key: c.key, label: c.label };
  }
  return null;
}

/** 「63個」「1,234」→ 数値。読めなければ null */
function count(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 「0.32%」→ 0.32。読めなければ null */
function percent(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 区切り線・空行など、意味を持たない行か */
function isNoise(line) {
  const t = line.trim();
  if (!t) return true;
  // ——— や --- のような区切り線
  return /^[-—–ー―_=＝\s]+$/.test(t);
}

/**
 * 「売上個数報告」を読み取る。
 *
 * @param {string} text
 * @returns {{units: object, totals: object, channels: string[]}|null}
 *   units  … { rakuten: { 'スーツケースS': 63, ... }, amazon: {...} }
 *   totals … 本文末尾の「合計」欄（あれば）
 */
export function parseUnitsReport(text) {
  if (!text || typeof text !== 'string') return null;
  if (!/個数|個\s*$/m.test(text)) return null;

  const units = {};
  const totals = {};
  const channels = [];

  let current = null; // 現在のチャネル（null = 未指定）
  let inTotals = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (isNoise(line)) continue;

    // 「合計」欄の始まり（チャネル指定より先に判定する）
    if (/^合計$/.test(line.replace(/[🔸🔹・\s]/g, ''))) {
      inTotals = true;
      current = null;
      continue;
    }

    // 見出し行（🔸楽天 など）。「：」を含まない行だけをチャネル候補とみなす
    if (!/[:：]/.test(line)) {
      const ch = normalizeChannel(line);
      if (ch) {
        current = ch.key;
        inTotals = false;
        if (!channels.includes(ch.key)) channels.push(ch.key);
        units[ch.key] ??= {};
      }
      continue;
    }

    // 「・商品名：63個」
    const m = line.match(/^[・\-*\s]*(.+?)\s*[:：]\s*(.+)$/);
    if (!m) continue;

    const product = m[1].replace(/^[🔸🔹・\s]+/, '').trim();
    const qty = count(m[2]);
    if (!product || qty === null) continue;

    // 日付行（🔸7/25(土)販売個数）を商品として拾わない
    if (/販売個数|報告|合計/.test(product)) continue;

    if (inTotals) {
      totals[product] = (totals[product] ?? 0) + qty;
    } else if (current) {
      units[current][product] = (units[current][product] ?? 0) + qty;
    }
  }

  const hasAny = channels.length > 0 || Object.keys(totals).length > 0;
  return hasAny ? { units, totals, channels } : null;
}

/**
 * 「転換率報告」から商品別転換率を読み取る。
 *
 * @param {string} text
 * @returns {{cvr: object, channels: string[]}|null}
 *   cvr … { rakuten: { '多機能PC(No.1)': 0.32, ... }, amazon: {...} }
 */
export function parseConversionReport(text) {
  if (!text || typeof text !== 'string') return null;
  if (!/転換率/.test(text)) return null;

  const cvr = {};
  const channels = [];
  let current = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (isNoise(line)) continue;

    // 【商品別転換率】のような見出しはチャネルをリセットする
    if (/^【.*】$/.test(line)) {
      current = null;
      continue;
    }

    if (!/[:：]/.test(line)) {
      const ch = normalizeChannel(line);
      if (ch) {
        current = ch.key;
        if (!channels.includes(ch.key)) channels.push(ch.key);
        cvr[ch.key] ??= {};
      }
      continue;
    }

    if (!current) continue;

    const m = line.match(/^[・\-*\s]*(.+?)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const product = m[1].replace(/^[🔸🔹▪️・\s]+/, '').trim();
    const value = percent(m[2]);
    if (!product || value === null) continue;
    // 「アクセス数：13,827」のような転換率以外の行は除く
    if (!/%|％/.test(m[2])) continue;

    cvr[current][product] = value;
  }

  return channels.length ? { cvr, channels } : null;
}

/** 商品名の表記ゆれをまとめる（「圧縮バック」と「圧縮バッグ」など） */
export function normalizeProduct(name) {
  return String(name ?? '')
    .trim()
    .replace(/[（(]\s*/g, '(')
    .replace(/\s*[）)]/g, ')')
    .replace(/バック/g, 'バッグ')
    .replace(/\s+/g, '');
}
