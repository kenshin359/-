// 危険判定（要確認フラグ）のテスト。8. の 1〜5 を確認します。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectDanger } from "../src/safety/dangerDetector.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dw = JSON.parse(readFileSync(join(__dirname, "../config/danger-words.json"), "utf8"));

test("8-1: 『軽いだけが取り柄』は危険判定されない（“だけが”の誤検知を除外）", () => {
  const r = { rating: 5, body: "とても軽いだけが取り柄で、持ち運びが楽です。" };
  const d = detectDanger(r, dw);
  assert.equal(d.hitWords.includes("けが"), false);
  assert.equal(d.needsHuman, false);
});

test("8-2: 『以前使っていたキャリーケースが壊れている』は危険判定されない（他社/過去）", () => {
  const r = { rating: 5, body: "以前使っていたキャリーケースが壊れているので、こちらは丈夫で満足です。" };
  const d = detectDanger(r, dw);
  assert.equal(d.hitWords.includes("壊れ"), false);
  assert.equal(d.needsHuman, false);
});

test("8-2b: 『遂に壊れたので購入』は危険判定されない（買い替え理由）", () => {
  const r = { rating: 5, body: "長年の相棒が遂に壊れたので購入しました。作りがよく満足しています。" };
  const d = detectDanger(r, dw);
  assert.equal(d.hitWords.includes("壊れ"), false);
  assert.equal(d.needsHuman, false);
});

test("8-3: 『届いて2日で壊れました』は必ず危険判定される", () => {
  const r = { rating: 5, body: "届いて2日で壊れました。とても残念です。" };
  const d = detectDanger(r, dw);
  assert.equal(d.hitWords.includes("壊れ"), true);
  assert.equal(d.needsHuman, true);
});

test("8-4: ★3のレビューは必ず『要確認』になる", () => {
  const r = { rating: 3, body: "普通に使えます。特に問題ありません。" };
  const d = detectDanger(r, dw);
  assert.equal(d.needsHuman, true);
});

test("8-5: ★2は（AIがどう言おうと）コード側で必ず『要確認』になる", () => {
  const r = { rating: 2, body: "思っていたのと少し違いました。" };
  const d = detectDanger(r, dw);
  // AIの needs_human に関係なく、星2で needsHuman=true
  assert.equal(d.needsHuman, true);
});

test("実害のある語（けが＝負傷）はちゃんと拾う", () => {
  const r = { rating: 5, body: "角で指をけがしてしまいました。" };
  const d = detectDanger(r, dw);
  assert.equal(d.hitWords.includes("けが"), true);
  assert.equal(d.needsHuman, true);
});
