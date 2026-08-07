// スプシ（中国チーム不具合リスト）の読み取り・絞り込みのテスト。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, toRecords } from "../src/sheets/fetchSheet.js";
import { effectiveCategory, extractChinaDefects, scrubNames } from "../src/sheets/chinaDefects.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rule = JSON.parse(readFileSync(join(__dirname, "../config/china-defects.json"), "utf8"));

test("CSV: 引用符内のカンマと改行を壊さずに読める（注文番号が改行入りでも）", () => {
  const csv = 'a,b,c\n1,"改行\nあり",3\n4,"カンマ,入り",6\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], "改行\nあり");
  assert.equal(rows[2][1], "カンマ,入り");
});

test("toRecords: 先頭の空行を飛ばして『日付』行をヘッダにする", () => {
  const csv = ",,\n日付,商品名,詳細内容\n2025-09-01,スーツケース,ネジ外れ\n";
  const { headers, records } = toRecords(csv);
  assert.ok(headers.includes("日付"));
  assert.equal(records.length, 1);
  assert.equal(records[0]["商品名"], "スーツケース");
});

test("分類: 初期不良は含める / 納期は除外 / FAQは除外", () => {
  assert.equal(effectiveCategory("初期不良", "", rule), "初期不良");
  assert.equal(effectiveCategory("納期", "納期関連", rule), null);
  assert.equal(effectiveCategory("初期不良", "よくある質問（FAQ分類用タグ）", rule), null);
});

test("分類: 未選択（プレースホルダ）でもタグが使用感不満なら含める", () => {
  const placeholder = "問い合わせ内容分類（商品改良/納期/初期不良/クレーム/交換/その他）";
  assert.equal(effectiveCategory(placeholder, "使用感不満", rule), "使用感不満");
  // タグがFAQなら含めない
  assert.equal(effectiveCategory(placeholder, "よくある質問（FAQ）", rule), null);
});

test("抽出: 個人情報（顧客名・注文番号）が結果に含まれない", () => {
  const csv =
    "日付,注文番号,顧客名（任意）,商品名,カラー,問い合わせ内容分類（商品改良/納期/初期不良/クレーム/交換/その他）,詳細内容,状況,FAQ分類用タグ\n" +
    "2025-09-10,407466-XXXX,山田様,スーツケースM,マットブラック,初期不良,ネジ外れ,完了,初期不良\n";
  const { headers, records } = toRecords(csv);
  const { defects } = extractChinaDefects(headers, records, rule, {});
  assert.equal(defects.length, 1);
  const keys = Object.keys(defects[0]);
  assert.ok(!keys.includes("注文番号"));
  assert.ok(!keys.some((k) => k.includes("顧客名")));
  // 出力JSONに個人情報の値が混ざっていないこと
  const json = JSON.stringify(defects[0]);
  assert.ok(!json.includes("山田"), "顧客名が出力に残っている");
  assert.ok(!json.includes("407466"), "注文番号が出力に残っている");
  // 必要な項目は入っている
  assert.equal(defects[0].product, "スーツケースM");
  assert.equal(defects[0].category, "初期不良");
});

test("抽出: sinceDate で直近だけに絞る（古い行・日付なしは除外）", () => {
  const csv =
    "日付,商品名,問い合わせ内容分類（商品改良/納期/初期不良/クレーム/交換/その他）,詳細内容,FAQ分類用タグ\n" +
    "2025-01-01,古い商品,初期不良,古い不具合,初期不良\n" +
    "2026-07-30,新しい商品,初期不良,新しい不具合,初期不良\n" +
    ",日付なし,初期不良,日付なし不具合,初期不良\n";
  const { headers, records } = toRecords(csv);
  const { defects, skippedNoDate } = extractChinaDefects(headers, records, rule, { sinceDate: "2026-07-28" });
  assert.equal(defects.length, 1);
  assert.equal(defects[0].product, "新しい商品");
  assert.equal(skippedNoDate, 1); // 日付なしは除外して件数記録
});

test("名前除去: 詳細内の『○○様購入分』や括弧内の名前を消し、不具合の中身は残す", () => {
  assert.equal(scrubNames("開いて真ん中部分のカバー外れ（イングリウッド様購入分）"), "開いて真ん中部分のカバー外れ");
  assert.equal(scrubNames("四つ角ビス外れ エルスタイル様購入分"), "四つ角ビス外れ");
  assert.equal(scrubNames("（田中様）キャスター不具合"), "キャスター不具合");
  // 名前が無い普通の詳細はそのまま
  assert.equal(scrubNames("キャスターロック不具合"), "キャスターロック不具合");
});

test("抽出: scrubNamesInDetail=true のとき詳細から名前が消える", () => {
  const csv =
    "日付,商品名,問い合わせ内容分類（商品改良/納期/初期不良/クレーム/交換/その他）,詳細内容,FAQ分類用タグ\n" +
    "2026-07-30,スーツケースM,初期不良,カバー外れ（イングリウッド様購入分）,初期不良\n";
  const { headers, records } = toRecords(csv);
  const rule2 = { ...rule, scrubNamesInDetail: true };
  const { defects } = extractChinaDefects(headers, records, rule2, { sinceDate: "2026-07-01" });
  assert.equal(defects[0].detail, "カバー外れ");
  assert.ok(!JSON.stringify(defects[0]).includes("イングリウッド"), "名前が残っている");
});

test("除外: 納期・FAQ 行は抽出されない", () => {
  const csv =
    "日付,商品名,問い合わせ内容分類（商品改良/納期/初期不良/クレーム/交換/その他）,詳細内容,FAQ分類用タグ\n" +
    "2026-07-30,商品A,納期,いつ届く？,納期関連\n" +
    "2026-07-30,商品B,問い合わせ内容分類（商品改良/納期/初期不良/クレーム/交換/その他）,鍵の使い方,よくある質問（FAQ分類用タグ）\n";
  const { headers, records } = toRecords(csv);
  const { defects } = extractChinaDefects(headers, records, rule, { sinceDate: "2026-07-01" });
  assert.equal(defects.length, 0);
});
