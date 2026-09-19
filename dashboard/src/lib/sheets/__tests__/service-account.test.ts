import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { buildJwt, parseServiceAccount } from '../service-account';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const sa = { client_email: 'dashboard-reader@example.iam.gserviceaccount.com', private_key: pem };

describe('Googleサービスアカウント（シート連携の安全な方式）', () => {
  it('環境変数は JSON そのまま／base64 のどちらでも読める。不正なら null', () => {
    const json = JSON.stringify(sa);
    expect(parseServiceAccount(json)?.client_email).toBe(sa.client_email);
    expect(parseServiceAccount(Buffer.from(json).toString('base64'))?.client_email).toBe(sa.client_email);
    expect(parseServiceAccount('')).toBeNull();
    expect(parseServiceAccount('{"foo":1}')).toBeNull();
    // \n がエスケープされた鍵も復元する
    const escaped = JSON.stringify({ ...sa, private_key: pem.replace(/\n/g, '\\n') });
    expect(parseServiceAccount(escaped)?.private_key).toBe(pem);
  });
  it('JWT は RS256 で署名され、iss/scope/aud/exp が正しい', () => {
    const jwt = buildJwt(sa, 'https://www.googleapis.com/auth/drive.readonly', 1_000_000);
    const [h, c, s] = jwt.split('.');
    const dec = (x: string) => JSON.parse(Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(dec(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(dec(c)).toEqual({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: 1_000_000, exp: 1_003_600 });
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))).toBe(true);
  });
});
