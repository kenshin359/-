import { withAuth } from 'next-auth/middleware';
import { resolveAuthSecret } from '@/lib/auth-secret';

// ログイン・認証API・静的ファイル以外は全ページ認証必須
// 署名鍵は src/lib/auth.ts と同じ resolveAuthSecret() で解決（NEXTAUTH_SECRET未設定でも止まらない）
// api/line/* はログインできない外部（LINE Webhook・Vercel Cron）から呼ばれるため除外し、
// それぞれ X-Line-Signature（HMAC-SHA256）／ Authorization: Bearer CRON_SECRET で自前検証する
// api/pro/ingest も同様に GitHub Actions から Bearer INGEST_SECRET で呼ばれるため除外（route.ts 側で検証）
export default withAuth({ secret: resolveAuthSecret(), pages: { signIn: '/login' } });

export const config = {
  matcher: ['/((?!api/auth|api/health|api/line|api/pro/ingest|login|_next/static|_next/image|favicon.ico).*)'],
};
