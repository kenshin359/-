// 返信組み立てのテスト。8. の 8〜9 を確認します。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assembleReply } from "../src/reply/assembleReply.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const blocks = JSON.parse(readFileSync(join(__dirname, "../config/reply-blocks.json"), "utf8"));

test("8-8: 謝罪が入るとき、感謝文が『嬉しく思います』にならない", () => {
  const reply = assembleReply({
    review: { rating: 3, body: "外箱がへこんでいて残念でした。", category: "suitcase" },
    ai: { body: "本文", needsApology: true, apology: "申し訳ございません。今後の改善に努めます。" },
    danger: { needsHuman: true },
    blocks,
  });
  assert.ok(!reply.includes("嬉しく思います"), "低評価/謝罪ありなのに『嬉しく思います』が入っている");
  assert.ok(reply.includes(blocks.thanks.apology), "謝罪時の感謝文になっていない");
});

test("8-8b: ★3は謝罪フラグが無くても『嬉しく思います』にならない（二重の歯止め）", () => {
  const reply = assembleReply({
    review: { rating: 3, body: "外箱がへこんでいました。", category: "unknown" },
    ai: { body: "本文", needsApology: false, apology: "" },
    danger: { needsHuman: true },
    blocks,
  });
  assert.ok(!reply.includes("嬉しく思います"));
});

test("8-9: ハンディファンのレビューに『キャリーケース』の結びが付かない", () => {
  const reply = assembleReply({
    review: { rating: 5, body: "風が強くて涼しいです。", category: "fan" },
    ai: { body: "本文", needsApology: false, apology: "" },
    danger: { needsHuman: false },
    blocks,
  });
  assert.ok(!reply.includes("キャリーケース"), "ファンなのにキャリーケースの結びが付いている");
  assert.ok(reply.includes(blocks.closing.default));
});

test("8-9b: category不明のときも無難な『弊社商品』の結びになる", () => {
  const reply = assembleReply({
    review: { rating: 5, body: "満足です。", category: "unknown" },
    ai: { body: "本文", needsApology: false, apology: "" },
    danger: { needsHuman: false },
    blocks,
  });
  assert.ok(!reply.includes("キャリーケース"));
  assert.ok(reply.includes(blocks.closing.default));
});

test("スーツケースの高評価にはキャリーケースの結びを使う", () => {
  const reply = assembleReply({
    review: { rating: 5, body: "静かでスムーズです。", category: "suitcase" },
    ai: { body: "本文", needsApology: false, apology: "" },
    danger: { needsHuman: false },
    blocks,
  });
  assert.ok(reply.includes("キャリーケース"));
});

test("長文レビュー(120字以上)では『丁寧で詳細な』感謝文を使う（謝罪が無いとき）", () => {
  const longBody = "あ".repeat(130);
  const reply = assembleReply({
    review: { rating: 5, body: longBody, category: "suitcase" },
    ai: { body: "本文", needsApology: false, apology: "" },
    danger: { needsHuman: false },
    blocks,
  });
  assert.ok(reply.includes(blocks.thanks.long));
});
