// LINE Messaging API の最小クライアント（監査役ボット用）。
// - 環境変数 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN のみを使う。未設定なら lineConfigured() が false。
// - 署名検証は HMAC-SHA256(base64) を timingSafeEqual で比較する。
// - ログには ID と文字数だけを出し、本文・トークンは絶対に出さない。
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.line.me/v2/bot';
// 1テキスト上限5000文字（安全側で4800）・1リクエスト最大5吹き出し（daily-report-system/lib/line.js と同じ）
const MAX_CHARS = 4800;
const MAX_BUBBLES = 5;

export function lineConfigured(): boolean {
  return Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN);
}

/** 未設定時に画面へ出す環境変数名（値は出さない） */
export const LINE_ENV_NAMES = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'] as const;

/** X-Line-Signature の検証。secret は引数で渡せる（テスト用）。 */
export function verifySignature(rawBody: string, signature: string | null | undefined, secret = process.env.LINE_CHANNEL_SECRET): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/** 署名を作る（動作確認用・docs/line-setup.md の curl 手順から使う） */
export function signBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

/** 長文を吹き出し（≤4800文字）に分割し、5吹き出しずつのリクエスト単位にまとめる */
export function splitForLine(texts: string[]): string[][] {
  const bubbles: string[] = [];
  for (const text of texts) {
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_CHARS) {
        bubbles.push(remaining);
        break;
      }
      let cut = remaining.lastIndexOf('\n', MAX_CHARS);
      if (cut < MAX_CHARS * 0.5) cut = MAX_CHARS;
      bubbles.push(remaining.slice(0, cut).trimEnd());
      remaining = remaining.slice(cut).trimStart();
    }
  }
  const requests: string[][] = [];
  for (let i = 0; i < bubbles.length; i += MAX_BUBBLES) requests.push(bubbles.slice(i, i + MAX_BUBBLES));
  return requests;
}

export class LineApiError extends Error {
  status: number;
  constructor(status: number, endpoint: string) {
    super(`LINE API ${endpoint} failed (${status})`);
    this.status = status;
  }
}

async function call(path: string, init: RequestInit & { label: string }): Promise<Response> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new LineApiError(0, init.label);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  return res;
}

/** push（1リクエスト5吹き出しまで。超える分は分割して順に送る） */
export async function pushMessage(to: string, texts: string[]): Promise<{ requests: number; bubbles: number }> {
  const requests = splitForLine(texts.filter((t) => t.length > 0));
  for (const group of requests) {
    const res = await call('/message/push', {
      label: 'push',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, messages: group.map((t) => ({ type: 'text', text: t })) }),
    });
    if (!res.ok) {
      console.warn(`[line] push failed status=${res.status} to=${to.slice(0, 6)}… bubbles=${group.length}`);
      throw new LineApiError(res.status, 'push');
    }
  }
  return { requests: requests.length, bubbles: requests.flat().length };
}

/** reply（replyToken は1回限り・約1分有効。失敗しても例外にせず false を返す） */
export async function replyMessage(replyToken: string, texts: string[]): Promise<boolean> {
  const group = splitForLine(texts.filter((t) => t.length > 0))[0] ?? [];
  if (group.length === 0) return false;
  try {
    const res = await call('/message/reply', {
      label: 'reply',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyToken, messages: group.map((t) => ({ type: 'text', text: t })) }),
    });
    if (!res.ok) console.warn(`[line] reply failed status=${res.status} bubbles=${group.length}`);
    return res.ok;
  } catch (e) {
    console.warn(`[line] reply error ${e instanceof Error ? e.name : 'unknown'}`);
    return false;
  }
}

/** グループ名（4xx は null で返す。プラン・権限により取れないことがある） */
export async function getGroupSummary(groupId: string): Promise<{ groupName: string; pictureUrl?: string } | null> {
  try {
    const res = await call(`/group/${encodeURIComponent(groupId)}/summary`, { label: 'group-summary', method: 'GET' });
    if (!res.ok) return null;
    const json = (await res.json()) as { groupName?: string; pictureUrl?: string };
    return json.groupName ? { groupName: json.groupName, pictureUrl: json.pictureUrl } : null;
  } catch {
    return null;
  }
}

/** グループ内メンバーの表示名（友だち追加していないユーザーは 4xx になるため null を許容） */
export async function getGroupMemberProfile(groupId: string, userId: string): Promise<{ displayName: string } | null> {
  try {
    const res = await call(`/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`, {
      label: 'member-profile',
      method: 'GET',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { displayName?: string };
    return json.displayName ? { displayName: json.displayName } : null;
  } catch {
    return null;
  }
}
