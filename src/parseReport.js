// 日次の「売上報告（文章）」を構造化データに変換するパーサー。
// 既存アプリに溜まっている下記のような文章を、数値の集まりに変換する：
//
//   2026/07/02(木)の売上をご報告いたします。
//   【売り上げ】
//   楽天：527,430円
//   Amazon：458,380円
//   自社サイト：398,360円
//   合計：1,384,170円
//   【ランキング】
//   ■楽天
//   多機能PC(No.1)：6位
//   ■Amazon
//   スーツケース：32位
//   【詳細数値】
//   ■楽天
//   アクセス数：13,827
//   転換率：0.17%
//   ...

// カンマ・空白・単位を除いて数値を取り出す
function num(s) {
  if (s == null) return null;
  const m = String(s).replace(/[,，\s]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// 【name】〜次の【 までのセクション本文を取り出す
function section(text, name) {
  const re = new RegExp(`【\\s*${name}\\s*】([\\s\\S]*?)(?=【|$)`);
  const m = text.match(re);
  return m ? m[1] : '';
}

// ■mall〜次の■ までのモール別ブロックを取り出す
function mallBlock(sectionText, mall) {
  const re = new RegExp(`[■▪]\uFE0F?\\s*${mall}([\\s\\S]*?)(?=[■▪]|$)`);
  const m = sectionText.match(re);
  return m ? m[1] : '';
}

// ブロック内の「label：値」を取り出す
function pick(block, label) {
  const m = block.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`));
  return m ? m[1].trim() : null;
}

export function parseReport(text) {
  if (!text || typeof text !== 'string') return null;
  if (!/売上|売り上げ|ご報告/.test(text)) return null;

  const out = {
    date: null,
    sales: { rakuten: null, amazon: null, own: null, tiktok: null, qoo10: null, base: null, total: null },
    metrics: { rakuten: {}, amazon: {} },
    ranking: [],
  };

  // 日付: 2026/07/02(木) / 2026-07-02 / 2026年7月2日
  const d = text.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (d) out.date = `${d[1]}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')}`;

  // ── 売上（【売り上げ】セクション内に限定してモール名の誤検出を防ぐ）──
  const salesSec = section(text, '売り上げ') || section(text, '売上') || text;
  out.sales.rakuten = num(pick(salesSec, '楽天'));
  out.sales.amazon = num(pick(salesSec, 'Amazon'));
  out.sales.own = num(pick(salesSec, '自社サイト')) ?? num(pick(salesSec, '自社'));
  out.sales.tiktok = num(pick(salesSec, 'TikTok'));
  out.sales.qoo10 = num(pick(salesSec, 'Qoo10'));
  out.sales.base = num(pick(salesSec, 'BASE')) ?? num(pick(salesSec, 'Base'));
  out.sales.total = num(pick(salesSec, '合計'));

  // ── 詳細数値（モール別指標）──
  const detail = section(text, '詳細数値') || text;
  const rk = mallBlock(detail, '楽天');
  const az = mallBlock(detail, 'Amazon');
  out.metrics.rakuten = {
    access: num(pick(rk, 'アクセス数')),
    cvr: num(pick(rk, '転換率')),
    fav: num(pick(rk, 'お気に入り登録数')),
    stay: num(pick(rk, '(?:ページ)?滞在時間')),
  };
  out.metrics.amazon = {
    access: num(pick(az, 'アクセス数')),
    cvr: num(pick(az, '転換率')),
  };

  // ── ランキング ──
  const rankSec = section(text, 'ランキング');
  for (const mall of ['楽天', 'Amazon']) {
    const blk = mallBlock(rankSec, mall);
    for (const m of blk.matchAll(/([^\n：:]+?)\s*[:：]\s*([^\n]+)/g)) {
      const product = m[1].trim();
      const val = m[2].trim();
      if (!product || /^[■▪]/.test(product)) continue;
      const outOfRank = /ランキング外|圏外/.test(val);
      out.ranking.push({ mall, product, rank: outOfRank ? null : num(val), outOfRank });
    }
  }

  return out;
}
