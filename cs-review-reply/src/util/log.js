// 画面表示のためのちいさなロガー。
// ★落とし穴2-5：お客様の情報（レビュー本文・投稿者名）はログに出しません。
//   --quiet のときは件数など最小限だけを出し、レビュー内容は一切出しません。

let quiet = false;

// --quiet が指定されたら呼ぶ。以後、詳細ログ（info）は抑制されます。
export function setQuiet(v) {
  quiet = !!v;
}

// 常に出す（件数・エラーなど、お客様情報を含まないもの）
export function say(...args) {
  console.log(...args);
}

// 詳細ログ。--quiet のときは出しません。
// ここに「お客様の生テキスト」を渡さないこと（渡す側の責任）。
export function info(...args) {
  if (!quiet) console.log(...args);
}

// エラーは常に出す。ただしお客様情報は載せないこと。
export function warn(...args) {
  console.warn(...args);
}
