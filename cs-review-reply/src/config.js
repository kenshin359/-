import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");

// ── .env の読み込み（依存ライブラリを増やさない簡易パーサ）──────────
// KEY=VALUE 形式のみ対応。# はコメント。既に process.env にある値は上書きしません。
function loadDotEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    // 前後のクオートを外す
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

export function readJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

// ★エラーメッセージは「どの設定が足りないか」を名前で書く（10.）。
//   読んだ人が次に何をすればいいか分かるようにします。
function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `設定「${name}」が空です。cs-review-reply/.env を開いて ${name} に値を入れてください。${
        hint ? "（" + hint + "）" : ""
      }`
    );
  }
  return v;
}

// アプリ全体で使う設定をまとめて返す。
// needSend=true のとき（＝実際に送るモード）だけ Chatwork/AI の必須チェックを行います。
export function loadConfig({ needSend } = {}) {
  const appEnv = process.env.APP_ENV || "test";
  // ★誤爆防止：APP_ENV=test の間は「送らない」を app 側で強制します（2. / 6.）。
  const isTest = appEnv !== "production";

  const cfg = {
    appEnv,
    isTest,
    rakuten: {
      shopId: process.env.RAKUTEN_SHOP_ID || "",
      shopCode: process.env.RAKUTEN_SHOP_CODE || "",
    },
    chatwork: {
      token: process.env.CHATWORK_API_TOKEN || "",
      csRoomId: process.env.CHATWORK_CS_ROOM_ID || "",
      chinaRoomId: process.env.CHATWORK_CHINA_ROOM_ID || "",
      snsRoomId: process.env.CHATWORK_SNS_ROOM_ID || "",
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    },
    // 中国チーム向け不具合リストの取得元（Googleスプレッドシートの共有URL）
    chinaSheet: {
      url: process.env.CHINA_SHEET_URL || "",
    },
    replyBlocks: readJson("config/reply-blocks.json"),
    dangerWords: readJson("config/danger-words.json"),
    promiseCheck: readJson("config/promise-check.json"),
    chinaDefects: readJson("config/china-defects.json"),
    items: readJson("config/rakuten-items.json"),
  };

  // レビュー取得にはショップIDが必須
  requireEnv("RAKUTEN_SHOP_ID", "レビューURLの数字部分");

  // 実際に送るモードのときだけ、送信系の必須項目を確認します。
  // （--dry-run や test では Chatwork トークンが無くても画面確認できるようにするため）
  if (needSend && !isTest) {
    requireEnv("CHATWORK_API_TOKEN");
    requireEnv("CHATWORK_CS_ROOM_ID", "CS専用グループ");
    // 中国チーム／SNSルームは任意（未設定ならその報告だけスキップ）。
  }

  return cfg;
}
