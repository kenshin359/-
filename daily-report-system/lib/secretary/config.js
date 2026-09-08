// ============================================================
//  AI秘書：設定ファイルの読み込み
// ------------------------------------------------------------
//  config/secretary/profile.json … 生活リズム・時間割・ルール・重みづけ
//  config/secretary/rules.json   … 言葉からカテゴリを判定する辞書
//  どちらも書き換えれば翌朝から反映されます（コード修正は不要）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'config', 'secretary');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadProfile(file) {
  return readJson(file ?? path.join(DIR, 'profile.json'));
}

export function loadRules(file) {
  return readJson(file ?? path.join(DIR, 'rules.json'));
}

/** "09:30" → 570（分） */
export function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** 570 → "09:30" */
export function toHHMM(min) {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 90 → "1時間30分" */
export function humanMinutes(min) {
  const m = Math.round(min);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}時間${r}分` : `${h}時間`;
}
