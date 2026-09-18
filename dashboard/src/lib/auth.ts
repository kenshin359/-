import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { resolveAuthSecret } from './auth-secret';

export type Role = 'admin' | 'editor' | 'viewer';

// 公開サーバーでの総当たり対策: 同一メールで15分内に10回失敗したら15分ロック
// （DB保存。Vercelのようにプロセスが分かれる環境でも共有される）
const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;

async function isLocked(email: string): Promise<boolean> {
  const f = await prisma.loginFailure.findUnique({ where: { email } });
  if (!f) return false;
  if (Date.now() > f.until.getTime()) {
    await prisma.loginFailure.delete({ where: { email } }).catch(() => undefined);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

async function recordFailure(email: string): Promise<void> {
  const f = await prisma.loginFailure.findUnique({ where: { email } });
  if (!f || Date.now() > f.until.getTime()) {
    await prisma.loginFailure.upsert({
      where: { email },
      update: { count: 1, until: new Date(Date.now() + LOCK_MS) },
      create: { email, count: 1, until: new Date(Date.now() + LOCK_MS) },
    });
  } else {
    await prisma.loginFailure.update({ where: { email }, data: { count: { increment: 1 } } });
  }
}

async function clearFailures(email: string): Promise<void> {
  await prisma.loginFailure.deleteMany({ where: { email } });
}

export const authOptions: NextAuthOptions = {
  secret: resolveAuthSecret(),
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
        if (await isLocked(email)) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        const ok = user ? await bcrypt.compare(credentials.password, user.passwordHash) : false;
        if (!user || !ok) {
          await recordFailure(email);
          return null;
        }
        await clearFailures(email);
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
