export { default } from 'next-auth/middleware';

// ログイン・認証API・静的ファイル以外は全ページ認証必須
export const config = {
  matcher: ['/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)'],
};
