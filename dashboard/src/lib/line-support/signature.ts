import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * LINE Messaging API の Webhook 署名検証。
 * リクエスト本文（生のバイト列）を Channel Secret で HMAC-SHA256 し、
 * base64 にしたものが X-Line-Signature ヘッダと一致すれば LINE からの正規リクエスト。
 * https://developers.line.biz/ja/docs/messaging-api/receiving-messages/#verifying-signatures
 */
export function computeLineSignature(channelSecret: string, rawBody: string | Buffer): string {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}

export function verifyLineSignature(
  channelSecret: string,
  rawBody: string | Buffer,
  signature: string | null | undefined,
): boolean {
  if (!channelSecret || !signature) return false;
  const expected = Buffer.from(computeLineSignature(channelSecret, rawBody));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
