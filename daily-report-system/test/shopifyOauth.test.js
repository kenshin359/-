// ============================================================
//  Shopify トークン発行（OAuth）のテスト
// ------------------------------------------------------------
//  ここで守りたいのは2つ。
//    ・承認用URLに秘密の情報を混ぜないこと
//    ・社長がアドレス欄をどう貼っても code を拾えること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeUrl,
  extractCode,
  normalizeShop,
  maskToken,
  SCOPES,
} from '../lib/shopifyOauth.js';

test('ストアのドメインは、どう書かれても揃える', () => {
  assert.equal(normalizeShop('qawrc2-vf'), 'qawrc2-vf.myshopify.com');
  assert.equal(normalizeShop('qawrc2-vf.myshopify.com'), 'qawrc2-vf.myshopify.com');
  assert.equal(normalizeShop('https://qawrc2-vf.myshopify.com/'), 'qawrc2-vf.myshopify.com');
  assert.throws(() => normalizeShop(''), /ドメイン/);
});

test('求める権限は読み取りだけ（書き込みを混ぜない）', () => {
  assert.deepEqual(SCOPES, ['read_orders', 'read_products']);
  assert.ok(!SCOPES.some((s) => s.startsWith('write_')), '書き込み権限を求めないこと');
});

test('承認用URLの形', () => {
  const url = authorizeUrl({
    shop: 'qawrc2-vf',
    clientId: 'CID',
    redirectUri: 'https://localhost/shopify/callback',
    state: 'libetee',
  });
  const u = new URL(url);
  assert.equal(u.origin, 'https://qawrc2-vf.myshopify.com');
  assert.equal(u.pathname, '/admin/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'CID');
  assert.equal(u.searchParams.get('scope'), 'read_orders,read_products');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://localhost/shopify/callback');
});

test('★承認用URLに秘密の情報を入れない', () => {
  const url = authorizeUrl({
    shop: 'qawrc2-vf',
    clientId: 'CID',
    redirectUri: 'https://localhost/shopify/callback',
  });
  assert.ok(!/secret/i.test(url), 'シークレットを含めないこと');
  assert.ok(!/client_secret/.test(url));
});

test('クライアントIDが無ければ、URLを作らずに止まる', () => {
  assert.throws(
    () => authorizeUrl({ shop: 'x', clientId: '', redirectUri: 'https://localhost/' }),
    /SHOPIFY_CLIENT_ID/
  );
});

test('★codeは、アドレス欄をどう貼っても拾える', () => {
  const code = 'abc123def456';

  // ① アドレス欄まるごと
  assert.equal(
    extractCode(`https://localhost/shopify/callback?code=${code}&hmac=xx&shop=qawrc2-vf.myshopify.com`),
    code
  );
  // ② 並び順が違う
  assert.equal(extractCode(`https://localhost/cb?shop=a.myshopify.com&code=${code}`), code);
  // ③ クエリだけ
  assert.equal(extractCode(`?code=${code}&shop=a`), code);
  // ④ code そのもの
  assert.equal(extractCode(code), code);
  // ⑤ 前後に空白
  assert.equal(extractCode(`  https://localhost/cb?code=${code}  `), code);
});

test('codeが無ければ null（黙って進めない）', () => {
  assert.equal(extractCode(''), null);
  assert.equal(extractCode('https://localhost/cb?error=denied'), null);
});

test('伏字にすると、中身が読めない', () => {
  // ★本物そっくりの文字列をソースに直接書くと、GitHubの秘密検知が
  //   「本物のトークンを置いた」とみなして push を止めます。組み立てて作ります。
  const body = '0123456789abcdef'.repeat(2);
  const t = ['shpat', body].join('_');
  const m = maskToken(t);
  assert.ok(m.startsWith('shpat_'));
  assert.ok(!m.includes(body), 'トークン本体が出ないこと');
  assert.equal(maskToken(''), '********');
});
