// ============================================================
//  環境変数の読み込みヘルパー
// ------------------------------------------------------------
//  - .env を（依存パッケージなしで）自前で読み込みます。
//  - 必須変数が TODO / 空 の場合はわかりやすいエラーを出します。
//  - 秘密情報は絶対にログに出しません（マスクして表示）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '.env');

// .env を1行ずつパースして process.env に載せる（既存の環境変数は上書きしない）
function loadDotEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 前後のクォートを除去
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

// 必須値を取得。未設定・TODO・要設定 の場合は例外。
export function required(key) {
  const v = process.env[key];
  if (!v || v === 'TODO' || v === '要設定') {
    throw new Error(`環境変数 ${key} が未設定です。.env を確認してください（現在: ${v ?? '(なし)'}）`);
  }
  return v;
}

// 任意値を取得（デフォルト付き）
export function optional(key, fallback = '') {
  const v = process.env[key];
  if (!v || v === 'TODO' || v === '要設定') return fallback;
  return v;
}

// 本番かどうか（APP_ENV=production のときだけ true）
export function isProduction() {
  return optional('APP_ENV', 'test') === 'production';
}

// 秘密情報をログ表示用にマスク（先頭4文字だけ残す）
export function mask(secret) {
  if (!secret) return '(なし)';
  const s = String(secret);
  if (s.length <= 4) return '****';
  return s.slice(0, 4) + '*'.repeat(Math.min(s.length - 4, 8));
}
