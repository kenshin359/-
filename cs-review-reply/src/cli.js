// コマンドライン引数の解析。7. のフラグに対応。
//   --dry-run  送らずに画面で確認
//   --quiet    件数だけ表示（お客様情報をログに残さない）
//   --init     既存レビューを「処理済み」にする（初回導入時／送信はしない）
//   --days=N   何日ぶんを対象にするか（既定 3）
//   --limit=N  一度に作る件数の上限（既定 20）
export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    dryRun: false,
    quiet: false,
    init: false,
    days: 3,
    limit: 20,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg === "--init") opts.init = true;
    else if (arg.startsWith("--days=")) opts.days = parseInt(arg.slice(7), 10) || opts.days;
    else if (arg.startsWith("--limit=")) opts.limit = parseInt(arg.slice(8), 10) || opts.limit;
  }
  return opts;
}
