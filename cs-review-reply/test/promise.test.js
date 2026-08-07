// 文面の約束チェックのテスト。8. の 6〜7 を確認します。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkPromises } from "../src/safety/promiseChecker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pc = JSON.parse(readFileSync(join(__dirname, "../config/promise-check.json"), "utf8"));

test("8-6: 『送料無料で対応いたします』は警告される", () => {
  const res = checkPromises("ご迷惑をおかけします。送料無料で対応いたします。", pc);
  assert.equal(res.ok, false);
  assert.ok(res.violations.length > 0);
});

test("8-7: 『送料のみお客様のご負担をお願いしております』は警告されない", () => {
  const res = checkPromises("恐れ入りますが、送料のみお客様のご負担をお願いしております。", pc);
  assert.equal(res.ok, true);
  assert.equal(res.violations.length, 0);
});

test("『全額返金します』は警告される", () => {
  const res = checkPromises("こちらで全額返金しますのでご安心ください。", pc);
  assert.equal(res.ok, false);
});

test("『新品と交換いたします』は警告される", () => {
  const res = checkPromises("不良品でしたら新品とお交換いたします。", pc);
  assert.equal(res.ok, false);
});

test("普通のお礼文は警告されない", () => {
  const res = checkPromises("お褒めのお言葉ありがとうございます。今後ともよろしくお願いいたします。", pc);
  assert.equal(res.ok, true);
});
