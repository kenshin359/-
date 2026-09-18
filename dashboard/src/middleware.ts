import { withAuth } from 'next-auth/middleware';
import { resolveAuthSecret } from '@/lib/auth-secret';

// ログイン・認証API・静的ファイル以外は全ページ認証必須
// 署名鍵は src/lib/auth.ts と同じ resolveAuthSecret() で解決（NEXTAUTH_SECRET未設定でも止まらない）
// api/line/webhook は LINE サーバーからの受信口なのでログイン不要（代わりに X-Line-Signature で検証）
export default withAuth({ secret: resolveAuthSecret(), pages: { signIn: '/login' } });

export const config = {
  matcher: ['/((?!api/auth|api/health|api/line/webhook|login|_next/static|_next/image|favicon.ico).*)'],
};
