import { info, say } from "../util/log.js";

// Chatwork へのメッセージ送信。
// ★落とし穴5-4：
//   ・1メッセージ4000字を超えると送れない → 自動分割する
//   ・[info][title]…[/title]…[/info] で見出しは付けられるが、
//     “コピペ用の下書き”に装飾を混ぜると貼ったとき記号が入る → 下書き本体は装飾なしで送る
//     （装飾を付けるかは呼び出し側が本文内で判断。ここでは素直に本文を送るだけ）

const MAX_LEN = 4000;

// 4000字を超える本文を、なるべく行の切れ目で分割する。
export function splitMessage(text, max = MAX_LEN) {
  const out = [];
  let remaining = String(text);
  while (remaining.length > max) {
    // max 以内で最後の改行を探して、そこで切る
    let cut = remaining.lastIndexOf("\n", max);
    if (cut <= 0) cut = max; // 改行が無ければ強制的に max で切る
    out.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}

// 実際に送る。
//   cfg     … loadConfig の結果（token とモード判定に使用）
//   roomId  … 送り先ルーム
//   text    … 本文
//   opts    … { dryRun, label, force }
// ★誤爆防止：APP_ENV=test か --dry-run のときは「送らずに画面表示だけ」。
//   force=true は「人が明示的に実行したテスト送信(npm run test-send)」専用の例外です。
//   毎朝の定時ジョブ(index.js)は force を渡さないので、この保護は外れません。
export async function sendChatwork(cfg, roomId, text, opts = {}) {
  const chunks = splitMessage(text);
  const label = opts.label || "メッセージ";

  if ((cfg.isTest && !opts.force) || opts.dryRun) {
    const why = cfg.isTest ? "APP_ENV=test" : "--dry-run";
    say(`  [送信スキップ:${why}] ${label} → room ${roomId || "(未設定)"} / ${chunks.length}通`);
    // 画面確認できるよう本文は info（--quiet では出さない）で表示
    for (const c of chunks) info("\n" + c + "\n");
    return { sent: false, chunks: chunks.length };
  }

  if (!roomId) {
    // 送るモードなのにルーム未設定 → 何をすればいいか分かるメッセージで知らせる
    say(`  [スキップ] ${label} の送り先ルームIDが未設定のため送りませんでした（.env の該当 ROOM_ID を設定してください）`);
    return { sent: false, chunks: chunks.length };
  }

  for (let i = 0; i < chunks.length; i++) {
    const url = `https://api.chatwork.com/v2/rooms/${roomId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-ChatWorkToken": cfg.chatwork.token,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ body: chunks[i] }).toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Chatwork送信に失敗（room ${roomId}, ${i + 1}/${chunks.length}通目, HTTP ${res.status}）: ${t.slice(0, 200)}`);
    }
    // 楽天ではないが、連続送信もほどほどに間隔をあける
    await new Promise((r) => setTimeout(r, 400));
  }
  say(`  [送信済] ${label} → room ${roomId} / ${chunks.length}通`);
  return { sent: true, chunks: chunks.length };
}
