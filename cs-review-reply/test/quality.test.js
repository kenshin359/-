// 品質チェック（実運用で見つかった4問題）のテスト。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  stripWrappingQuotes,
  checkProductMismatch,
  checkComplaintMishandled,
  checkRepeatedPhrases,
} from "../src/safety/qualityChecks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dirname, "../config/quality-check.json"), "utf8"));

test("問題1: コピペ時の 〝〟 など囲み引用符を除去する", () => {
  assert.equal(stripWrappingQuotes("〝この度はありがとうございます。〟"), "この度はありがとうございます。");
  assert.equal(stripWrappingQuotes('"ご利用ありがとうございます。"'), "ご利用ありがとうございます。");
  assert.equal(stripWrappingQuotes("「全体を囲むカギ括弧」"), "全体を囲むカギ括弧");
  // 本文中の「」は残す（全体を囲んでいない）
  assert.equal(stripWrappingQuotes("静音性「キャスター」についてご評価ありがとうございます。"),
    "静音性「キャスター」についてご評価ありがとうございます。");
  // 引用符なしはそのまま
  assert.equal(stripWrappingQuotes("普通の文です。"), "普通の文です。");
});

test("問題3: ファンの返信にスーツケース用語が入ったら要確認", () => {
  const r = checkProductMismatch("風量についてお褒めのお言葉、またヒノモトキャスターも好評です。", "fan", cfg);
  assert.equal(r.ok, false);
  assert.ok(r.reasons[0].includes("ヒノモトキャスター") || r.reasons[0].includes("キャスター"));
});

test("問題3: スーツケースの返信にキャスターが出ても問題なし", () => {
  const r = checkProductMismatch("キャスターの動きにご満足いただけ光栄です。", "suitcase", cfg);
  assert.equal(r.ok, true);
});

test("問題3: ショップレビュー(unknown)は商品ミスマッチ判定をしない", () => {
  const r = checkProductMismatch("キャスターが静かとのこと。", "unknown", cfg);
  assert.equal(r.ok, true);
});

test("問題4: 不満(たら良かった)なのにお詫びなしで満足と返すと要確認", () => {
  const review = "梱包をもう少し丁寧にしてくれたら良かったです。";
  const reply = "梱包の状態にもご満足いただけたようで安心いたしました。";
  const r = checkComplaintMishandled(review, reply, cfg);
  assert.equal(r.ok, false);
});

test("問題4: 不満をちゃんとお詫び/改善で受けていれば問題なし", () => {
  const review = "梱包をもう少し丁寧にしてくれたら良かったです。";
  const reply = "梱包につきましてご不便をおかけし申し訳ございません。今後の改善の参考にさせていただきます。";
  const r = checkComplaintMishandled(review, reply, cfg);
  assert.equal(r.ok, true);
});

test("問題4: 不満マーカーが無ければ判定しない", () => {
  const r = checkComplaintMishandled("とても満足です。", "ご満足いただけ光栄です。", cfg);
  assert.equal(r.ok, true);
});

test("問題4: 否定形『気になりません』は不満ではない（誤検知しない）", () => {
  // 実運用テストで出た誤検知：★5の純ポジティブが🔴になっていた
  const review = "キャスターがとても静かで、深夜の帰宅でも気になりません。出張で毎週使っていますが大満足です。";
  const reply = "静音性にご満足いただけ光栄です。";
  const r = checkComplaintMishandled(review, reply, cfg);
  assert.equal(r.ok, true);
});

test("問題4: 『不満はありません』も否定形なので誤検知しない", () => {
  const r = checkComplaintMishandled("使い勝手に不満はありません。大満足です。", "ご満足いただけ光栄です。", cfg);
  assert.equal(r.ok, true);
});

test("問題4: 否定でない『音が気になります』は不満として拾う", () => {
  const r = checkComplaintMishandled("風量は良いが音が気になります。", "ご満足いただけ光栄です。", cfg);
  assert.equal(r.ok, false);
});

test("問題2: 同じ言い回しが2回で語尾重複を検出", () => {
  const reply = "静音性に安心いたしました。使い勝手にも安心いたしました。";
  const r = checkRepeatedPhrases(reply, cfg);
  assert.equal(r.ok, false);
  assert.ok(r.reasons[0].includes("安心いたしました"));
});

test("問題2: 一般的な『ありがとうございます』の重なりは🔴にしない（過剰な要確認を防ぐ）", () => {
  // 挨拶＋感謝で自然に2回程度は重なる。ここでは flag しない方針。
  const reply = "ご利用ありがとうございます。温かいお言葉ありがとうございます。";
  const r = checkRepeatedPhrases(reply, cfg);
  assert.equal(r.ok, true);
});

test("問題2: 重複がなければ問題なし", () => {
  const reply = "静音性にご満足いただけ光栄です。今後ともよろしくお願いいたします。";
  const r = checkRepeatedPhrases(reply, cfg);
  assert.equal(r.ok, true);
});
