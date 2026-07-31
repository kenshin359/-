// スプシのCS問い合わせ管理表から、中国（制作）チーム向けの「不具合行」を抜き出します。
// ★個人情報は持ち出しません：顧客名・注文番号は取り出さず、
//   制造の改善に必要な（日付・商品・カラー・分類・詳細・状況）だけにします。
//
// 絞り込みルールは config/china-defects.json 側。ここはロジック。

// 日付を YYYY-MM-DD に正規化（"2025-08-29" / "2025/09/08" 等）。取れなければ ""。
function normalizeDate(raw) {
  const m = String(raw || "").match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

// ヘッダ名は長い/変わりうるので、部分一致で列を探す
function findHeader(headers, needle, fallback) {
  return headers.find((h) => h.includes(needle)) || fallback || needle;
}

// 1行の「有効な不具合カテゴリ」を判定。対象外なら null。
export function effectiveCategory(catRaw, tagRaw, rule) {
  const cat = String(catRaw || "").trim();
  const tag = String(tagRaw || "").trim();

  // FAQ（よくある質問）は除外
  if (rule.faqTagContains && tag.includes(rule.faqTagContains)) return null;
  // 明示的な除外（納期など）
  if (rule.excludeCategories.includes(cat)) return null;
  if (rule.excludeTags.includes(tag)) return null;

  // 分類が正しく入っていれば、それを採用
  if (rule.includeCategories.includes(cat)) return cat;

  // 分類が未選択（プレースホルダ「問い合わせ内容分類（…）」）や空欄なら、タグで判定
  const placeholder = cat === "" || cat.startsWith("問い合わせ内容分類");
  if (placeholder && rule.includeTags.includes(tag)) return tag;

  return null;
}

// records（toRecords の結果）→ 不具合エントリ配列
//   opts.sinceDate: "YYYY-MM-DD"。これ以降の日付だけ残す（直近N日分）。
//                   未指定なら日付で絞らない（テスト表示など）。
// 返り値：{ defects:[{date,product,color,category,detail,status}], skippedNoDate, total }
export function extractChinaDefects(headers, records, rule, opts = {}) {
  const cDate = findHeader(headers, "日付");
  const cProduct = findHeader(headers, "商品名");
  const cColor = findHeader(headers, "カラー");
  const cCat = findHeader(headers, "問い合わせ内容分類");
  const cDetail = findHeader(headers, "詳細内容");
  const cStatus = findHeader(headers, "状況");
  const cTag = findHeader(headers, "FAQ分類用タグ");

  const defects = [];
  let skippedNoDate = 0;

  for (const r of records) {
    const category = effectiveCategory(r[cCat], r[cTag], rule);
    if (!category) continue; // 不具合以外（納期・FAQ・分類不明）は対象外

    const date = normalizeDate(r[cDate]);
    if (opts.sinceDate) {
      if (!date) {
        skippedNoDate++; // 日付が無いと直近判定できないので、日次では除外（件数だけ記録）
        continue;
      }
      if (date < opts.sinceDate) continue;
    }

    defects.push({
      date,
      product: (r[cProduct] || "").trim() || "（商品名なし）",
      color: (r[cColor] || "").trim(),
      category,
      detail: (r[cDetail] || "").trim(),
      status: (r[cStatus] || "").trim(),
    });
  }

  return { defects, skippedNoDate, total: records.length };
}
