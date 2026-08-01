// ============================================================
//  Shopify のアクセストークンを1回だけ発行する（OAuth）
// ------------------------------------------------------------
//  ★なぜこれが必要になったか
//    Shopify は「ストア専用アプリ（カスタムアプリ）」を廃止しました。
//    以前はその画面に shpat_ で始まるトークンが表示されましたが、
//    いまは Dev Dashboard でアプリを作る形に変わり、
//    トークンは画面に出ません（クライアントID＋シークレットだけ）。
//
//    そこで、Shopify が定めた正規の手順（OAuth）で
//    トークンを1回だけ発行します。発行したトークンに期限はありません。
//
//  ★流れ（3ステップ）
//    ① 承認用のURLを作る          … このファイルの authorizeUrl()
//    ② 社長がブラウザで開いて承認  … 戻り先URLに「code」が付いてくる
//    ③ code をトークンに交換       … このファイルの exchangeCode()
//
//  ★code は使い捨てで、数分で無効になります。
//    ②と③は続けて行ってください。
//
//  ★トークンは画面にもログにも出しません。
//    出してしまうと、公開リポジトリの実行ログに残ってしまうためです。
// ============================================================
import { fetchWithRetry } from './httpRetry.js';

/** ストアのドメインを整える（https:// や 末尾スラッシュを許容） */
export function normalizeShop(shop) {
  const s = String(shop ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!s) throw new Error('ストアのドメインが空です（例: qawrc2-vf.myshopify.com）');
  return s.endsWith('.myshopify.com') ? s : `${s}.myshopify.com`;
}

/** 必要な権限。読み取りだけ。書き込みは一切求めません */
export const SCOPES = ['read_orders', 'read_products'];

/**
 * ① 承認用のURLを作る。
 *    このURLに秘密の情報は入りません（クライアントIDは公開してよい値です）。
 */
export function authorizeUrl({ shop, clientId, redirectUri, state, scopes = SCOPES }) {
  if (!clientId) throw new Error('SHOPIFY_CLIENT_ID が未設定です');
  if (!redirectUri) throw new Error('戻り先URL（redirectUri）が未設定です');
  const u = new URL(`https://${normalizeShop(shop)}/admin/oauth/authorize`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('scope', scopes.join(','));
  u.searchParams.set('redirect_uri', redirectUri);
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

/**
 * 戻ってきたURL（またはcodeそのもの）から code を取り出す。
 * ★社長にはアドレス欄をまるごと貼っていただくほうが確実なので、
 *   URLでもcode単体でも受け取れるようにします。
 */
export function extractCode(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (!s.includes('?') && !s.includes('=')) return s; // code そのもの
  try {
    const u = new URL(s.startsWith('http') ? s : `https://localhost/?${s.replace(/^\?/, '')}`);
    return u.searchParams.get('code');
  } catch {
    const m = s.match(/[?&]code=([^&\s]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

/**
 * ③ code をアクセストークンに交換する。
 * @returns {Promise<{accessToken: string, scope: string}>}
 */
export async function exchangeCode({ shop, clientId, clientSecret, code }) {
  if (!clientId) throw new Error('SHOPIFY_CLIENT_ID が未設定です');
  if (!clientSecret) throw new Error('SHOPIFY_CLIENT_SECRET が未設定です');
  if (!code) throw new Error('code が空です。承認後のURLをそのまま貼ってください');

  const res = await fetchWithRetry(
    `https://${normalizeShop(shop)}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    },
    { label: 'shopify oauth', retries: 1 }
  );

  const token = res.json?.access_token;
  if (!token) {
    // ★エラーの中身にトークンは入りませんが、念のため短く切って出します
    const why = JSON.stringify(res.json ?? {}).slice(0, 200);
    throw new Error(
      'トークンを受け取れませんでした。よくある原因:\n' +
        '  ・code の期限切れ（数分で切れます。もう一度承認からやり直してください）\n' +
        '  ・code をすでに1回使っている（使い捨てです）\n' +
        '  ・クライアントIDかシークレットの取り違え\n' +
        `  Shopifyの応答: ${why}`
    );
  }
  return { accessToken: token, scope: res.json?.scope ?? '' };
}

/** ログに出さないための伏字（先頭6文字と長さだけ見せる） */
export function maskToken(token) {
  const s = String(token ?? '');
  if (s.length <= 8) return '********';
  return `${s.slice(0, 6)}…（全${s.length}文字）`;
}
