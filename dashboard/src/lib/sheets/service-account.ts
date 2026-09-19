// Google サービスアカウント（GOOGLE_SHEETS_SA_JSON）でのアクセストークン取得。
// 依存ライブラリ無し: JWT(RS256) を node:crypto で署名し、OAuth2 トークンエンドポイントと交換する。
// 権限は drive.readonly のみ（読むだけ）。鍵の中身はログに出さない。
import { createSign } from 'node:crypto';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** 環境変数の値（JSONそのまま、または base64 化した JSON）をパースする。無効なら null */
export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const tryParse = (t: string): ServiceAccount | null => {
    try {
      const o = JSON.parse(t) as Partial<ServiceAccount>;
      if (o && typeof o.client_email === 'string' && typeof o.private_key === 'string') {
        return { client_email: o.client_email, private_key: o.private_key.replace(/\\n/g, '\n'), token_uri: o.token_uri };
      }
    } catch {
      /* fallthrough */
    }
    return null;
  };
  return tryParse(s) ?? tryParse(Buffer.from(s, 'base64').toString('utf8'));
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** RS256 の JWT を作る（テスト可能な純関数。now は秒） */
export function buildJwt(sa: ServiceAccount, scope: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope, aud, iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(sa.private_key));
  return `${header}.${claim}.${sig}`;
}

let cached: { token: string; exp: number } | null = null;

/** アクセストークン（メモリキャッシュ・期限5分前に更新）。サービスアカウント未設定なら null */
export async function getServiceAccountToken(scope = 'https://www.googleapis.com/auth/drive.readonly'): Promise<string | null> {
  const sa = parseServiceAccount(process.env.GOOGLE_SHEETS_SA_JSON);
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 300 > now) return cached.token;
  const jwt = buildJwt(sa, scope, now);
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`サービスアカウントのトークン取得に失敗（HTTP ${res.status}）。鍵JSONと Drive API の有効化を確認してください`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}
