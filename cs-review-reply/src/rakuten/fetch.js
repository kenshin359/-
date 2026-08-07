// 楽天ページの取得。
// ★★落とし穴5-1（実測済み）★★
//   ・review.rakuten.co.jp は素の取得だと 403。ブラウザのUAを付けると 200。
//   ・item.rakuten.co.jp はさらに厳しく、UAだけだと 42バイトのエラーページ。
//     下の Sec-Fetch-* まで“すべて”付けると通る。
//   ・Playwright/ヘッドレスブラウザは使わない（実行環境のプロキシを通れず接続不可だった）。
//   ・楽天サーバーへは 1.5秒以上あけてアクセスする。

// ★item ページまで通すために必要だったヘッダ一式（減らさないこと）
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const MIN_INTERVAL_MS = 1500; // ★楽天への最低アクセス間隔（5-1）
let lastFetchAt = 0;

async function politeWait() {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

// HTMLを取得して文字列で返す。403等は分かりやすいエラーにする。
export async function fetchHtml(url) {
  await politeWait();
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) {
    throw new Error(
      `楽天ページの取得に失敗（HTTP ${res.status}）: ${url}\n` +
        `（403なら短時間のアクセス過多が疑われます。時間をあけて再実行してください）`
    );
  }
  const html = await res.text();
  // ★item ページで“42バイトのエラーページ”が返る既知の失敗。短すぎる本文は失敗扱い。
  if (html.length < 200) {
    throw new Error(
      `楽天ページの中身が異常に短い（${html.length}バイト）: ${url}\n` +
        `（item ページはヘッダ不足だとこの状態になります。fetch.js のヘッダを減らさないでください）`
    );
  }
  return html;
}
