#!/usr/bin/env node
// ============================================================
//  Shopify のアクセストークンを1回だけ発行する
// ------------------------------------------------------------
//  実行:
//    node scripts/shopifyToken.js                 … 承認用URLを表示
//    node scripts/shopifyToken.js --code="<URL>"  … トークンに交換して Chatwork へ
//
//  ★トークンは画面にもログにも出しません。
//    このリポジトリは公開されているため、実行ログに出すと誰でも読めてしまいます。
//    受け取りは Chatwork（社長のマイチャット）経由にしています。
//
//  ★発行したトークンに期限はありません。この作業は最初の1回だけです。
// ============================================================
import { optional, required } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { authorizeUrl, exchangeCode, extractCode, maskToken, SCOPES } from '../lib/shopifyOauth.js';

/** 戻り先URL。つながらないURLでかまいません（アドレス欄のcodeを使うため） */
export const REDIRECT_URI = 'https://localhost/shopify/callback';

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/**
 * Chatwork へ直接送る。
 * ★共通の pushChatwork は「テスト環境だと本文を画面に出す」作りなので、
 *   トークンを扱うここでは使いません。うっかりログに残さないためです。
 */
async function sendSecret(body) {
  const token = required('CHATWORK_API_TOKEN');
  const roomId =
    optional('CHATWORK_SECRET_ROOM_ID') || optional('CHATWORK_ROOM_ID');
  if (!roomId) {
    throw new Error(
      '送り先が未設定です。CHATWORK_SECRET_ROOM_ID（できれば社長のマイチャット）を設定してください。'
    );
  }
  await fetchWithRetry(
    `https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/messages`,
    {
      method: 'POST',
      headers: {
        'X-ChatWorkToken': token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ body, self_unread: '0' }).toString(),
    },
    { label: 'chatwork(secret)', retries: 3 }
  );
  return roomId;
}

function showAuthorizeUrl() {
  const shop = required('SHOPIFY_SHOP_DOMAIN');
  const clientId = required('SHOPIFY_CLIENT_ID');
  const url = authorizeUrl({ shop, clientId, redirectUri: REDIRECT_URI, state: 'libetee' });

  console.log('');
  console.log('════════ ①このURLをブラウザで開いてください ════════');
  console.log('');
  console.log(url);
  console.log('');
  console.log('════════════════════════════════════════════════════');
  console.log('');
  console.log('② 求められる権限が次の2つだけであることを確認して「インストール」を押す');
  for (const s of SCOPES) console.log(`     ・${s}`);
  console.log('');
  console.log('③ 「このサイトにアクセスできません」という画面になります。それで正常です。');
  console.log('   ブラウザの【アドレス欄】をまるごとコピーしてください。');
  console.log(`   （${REDIRECT_URI}?code=… という形になっています）`);
  console.log('');
  console.log('④ もう一度このワークフローを実行し、「code」の欄にそれを貼り付けてください。');
  console.log('   ★codeは数分で切れます。③のあとすぐに実行してください。');
  console.log('');
}

async function exchange(raw) {
  const shop = required('SHOPIFY_SHOP_DOMAIN');
  const clientId = required('SHOPIFY_CLIENT_ID');
  const clientSecret = required('SHOPIFY_CLIENT_SECRET');

  const code = extractCode(raw);
  if (!code) {
    throw new Error(
      'code を読み取れませんでした。承認後のアドレス欄をまるごと貼り付けてください。'
    );
  }

  const { accessToken, scope } = await exchangeCode({ shop, clientId, clientSecret, code });

  // ★ここでも中身は出しません
  console.log('✅ トークンを発行しました');
  console.log(`   権限: ${scope || '(不明)'}`);
  console.log(`   トークン: ${maskToken(accessToken)}`);

  const body = [
    '[info][title]🔑 Shopifyのアクセストークン（取り扱い注意）[/title]',
    '下の1行をコピーして、GitHubのSecretsに登録してください。',
    '',
    '  名前: SHOPIFY_ADMIN_TOKEN',
    '  値:',
    accessToken,
    '',
    `権限: ${scope || '(不明)'}`,
    '',
    '★登録が終わったら、このメッセージを削除してください。',
    '  （チャットに残しておくと、見られた人が注文データを読めてしまいます）',
    '[/info]',
  ].join('\n');

  const roomId = await sendSecret(body);
  console.log(`   Chatwork（ルーム ${roomId}）に送りました。そちらからコピーしてください。`);
  console.log('   ★GitHubのSecretsに登録したら、そのメッセージは削除してください。');
}

async function main() {
  const raw = arg('code');
  if (!raw) {
    showAuthorizeUrl();
    return;
  }
  await exchange(raw);
}

if (process.argv[1] && process.argv[1].endsWith('shopifyToken.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
