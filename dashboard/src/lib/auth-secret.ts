/**
 * ログインセッションの署名鍵。
 * 通常は環境変数 NEXTAUTH_SECRET（または AUTH_SECRET）を使う。
 * どちらも未設定・空の場合は、すでに秘密情報である DATABASE_URL から鍵を派生させて起動を止めない
 * （鍵が無いと next-auth は全リクエストで「サーバー設定エラー」になるため）。
 * DATABASE_URL を変えると既存のログインが全員無効になる点だけ注意。正式運用では NEXTAUTH_SECRET を設定すること。
 * ※ middleware（Edge）でも使うため Node の crypto には依存しない。
 */
export function resolveAuthSecret(): string | undefined {
  const explicit = (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || '').trim();
  if (explicit) return explicit;
  const db = (process.env.DATABASE_URL || '').trim();
  if (db) return `libetee-dashboard-derived:${db}`;
  return undefined; // 開発時は next-auth が警告付きで自動生成する
}
