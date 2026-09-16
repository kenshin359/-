import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

export type Role = 'admin' | 'editor' | 'viewer';

// 公開サーバーでの総当たり対策: 同一メールで15分内に10回失敗したら15分ロック
// （プロセス内メモリ。複数台構成にする場合はRedis等へ移す）
const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; until: number }>();

function isLocked(email: string): boolean {
  const f = failures.get(email);
  if (!f) return false;
  if (Date.now() > f.until) {
    failures.delete(email);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

function recordFailure(email: string): void {
  const f = failures.get(email);
  if (!f || Date.now() > f.until) {
    failures.set(email, { count: 1, until: Date.now() + LOCK_MS });
  } else {
    f.count += 1;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'メールアドレスとパスワード',
      credentials: {
        email: { label: 'メールアドレス', type: 'email' },
        password: { label: 'パスワード', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.trim().toLowerCase();
        if (isLocked(email)) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        const ok = user ? await bcrypt.compare(credentials.password, user.passwordHash) : false;
        if (!user || !ok) {
          recordFailure(email);
          return null;
        }
        failures.delete(email);
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? 'viewer';
        token.uid = (user as { id?: string }).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as Role) ?? 'viewer';
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
};

/** サーバー側の書込権限判定（viewerは全書込API拒否） */
export function canWrite(role: string | undefined): boolean {
  return role === 'admin' || role === 'editor';
}
