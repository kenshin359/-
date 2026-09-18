/**
 * LINE Messaging API クライアント（reply / push）。
 * - reply: Webhook で受け取った replyToken に対する返信（無料・1回限り・約1分で失効）
 * - push : 任意の宛先へ送信（スタッフ通知用。無料通数の上限に注意）
 * 1メッセージ5000文字・1回5吹き出しの制限に合わせて自動分割する。
 */

const API_BASE = 'https://api.line.me/v2/bot';
const MAX_CHARS = 4800;
const MAX_BUBBLES = 5;

export function splitForLine(text: string): string[] {
  const bubbles: string[] = [];
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
  return bubbles.slice(0, MAX_BUBBLES);
}

function token(): string {
  const t = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  if (!t) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  return t;
}

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LINE API ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

export async function replyText(replyToken: string, text: string): Promise<void> {
  const messages = splitForLine(text).map((t) => ({ type: 'text', text: t }));
  if (messages.length === 0) return;
  await post('/message/reply', { replyToken, messages });
}

export async function pushText(to: string, text: string): Promise<void> {
  const messages = splitForLine(text).map((t) => ({ type: 'text', text: t }));
  if (messages.length === 0) return;
  await post('/message/push', { to, messages });
}
