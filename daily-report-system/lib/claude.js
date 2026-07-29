// ============================================================
//  Claude API クライアント
// ------------------------------------------------------------
//  - Anthropic Messages API を呼び出し、社長・部長向け日報を生成。
//  - system プロンプトは prompts/ から読み込みます。
//  - 出力は「表示用テキスト」と「構造化JSON」の両方を返すよう指示。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { required, optional } from './env.js';
import { fetchWithRetry } from './httpRetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function readPrompt(file) {
  return fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8');
}

/**
 * Claude を呼び出して素のテキスト応答を得る低レベル関数。
 * @param {object} opts { system, userText, maxTokens }
 * @returns {Promise<string>} テキスト
 */
export async function callClaudeRaw({ system, userText, maxTokens = 3000 }) {
  const apiKey = required('ANTHROPIC_API_KEY');
  const model = optional('ANTHROPIC_MODEL', 'claude-sonnet-5');

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userText }],
  };

  const res = await fetchWithRetry(
    ANTHROPIC_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    },
    { label: 'claude', retries: 4, baseDelayMs: 2000 }
  );

  const json = res.json;
  // Messages API のテキストは content[].text に入る
  const text = (json?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude から空の応答が返りました');
  return text;
}

/**
 * 画像（日報のスクリーンショット）を Claude に読ませる。
 *
 * リベティの日報は Excel のスクリーンショット画像なので、
 * 文章ではなく画像として送る必要がある。
 *
 * @param {object} opts { system, userText, images: [{base64, mediaType}], maxTokens }
 * @returns {Promise<string>} テキスト
 */
export async function callClaudeWithImages({ system, userText, images = [], maxTokens = 1500 }) {
  const apiKey = required('ANTHROPIC_API_KEY');
  const model = optional('ANTHROPIC_MODEL', 'claude-sonnet-5');

  // content は「画像 → 指示文」の順に並べるのが読み取り精度に有利
  const content = [
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    })),
    { type: 'text', text: userText },
  ];

  const res = await fetchWithRetry(
    ANTHROPIC_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
    },
    { label: 'claude-vision', retries: 4, baseDelayMs: 2000 }
  );

  const text = (res.json?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude から空の応答が返りました');
  return text;
}

/**
 * 日報画像1枚を読んで、通知用の要約を返す。
 * @param {object} opts { base64, mediaType, reporter, team, date }
 * @returns {Promise<{summary, urgent, urgent_reason, done, tomorrow}>}
 */
export async function summarizeReportImage({ base64, mediaType, reporter, team, date }) {
  const system = readPrompt('single-report-prompt.md');
  const userText =
    `この画像は ${date} の業務日報です（報告者: ${reporter ?? '不明'} / チーム: ${team ?? '不明'}）。\n` +
    '読み取って、指定のJSONだけを出力してください。';
  const raw = await callClaudeWithImages({ system, userText, images: [{ base64, mediaType }], maxTokens: 1000 });
  return parseJsonFromModel(raw);
}

/**
 * 日報群を分析して、構造化された経営日報オブジェクトを返す。
 * Claude には「必ず JSON だけを返す」よう指示し、パースする。
 * @param {object} input { dateISO, reports: [...正規化済み日報], previousIssues?: [...] }
 * @returns {Promise<object>} AI経営日報の構造化データ
 */
export async function analyzeReports(input) {
  const system = readPrompt('daily-report-system-prompt.md');
  const template = readPrompt('daily-report-user-template.md');

  // ユーザーメッセージ = テンプレート + 実データ(JSON)
  const userText =
    template +
    '\n\n### 入力データ(JSON)\n```json\n' +
    JSON.stringify(input, null, 2) +
    '\n```\n';

  const raw = await callClaudeRaw({ system, userText, maxTokens: 4000 });
  return parseJsonFromModel(raw);
}

/**
 * 緊急案件の1件を、LINE即時通知向けに要約する。
 * @param {object} incident
 * @returns {Promise<{line_text: string, severity: string}>}
 */
export async function summarizeUrgent(incident) {
  const system = readPrompt('urgent-summary-prompt.md');
  const userText = '### 緊急案件データ(JSON)\n```json\n' + JSON.stringify(incident, null, 2) + '\n```\n';
  const raw = await callClaudeRaw({ system, userText, maxTokens: 1000 });
  return parseJsonFromModel(raw);
}

// モデル出力から JSON を安全に取り出す（```json フェンスや前後の文章を許容）
export function parseJsonFromModel(text) {
  let t = text.trim();
  // ```json ... ``` フェンスを剥がす
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 最初の { から最後の } までを抽出（保険）
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last !== -1) t = t.slice(first, last + 1);
  try {
    return JSON.parse(t);
  } catch (e) {
    const err = new Error(`Claude 応答のJSONパースに失敗: ${e.message}`);
    err.raw = text;
    throw err;
  }
}
