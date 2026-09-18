import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Supabase のプーリング接続（*.pooler.supabase.com:6543）は PgBouncer のトランザクションモードのため、
 * Prisma には `pgbouncer=true` が必要。URLに無ければ自動で付ける（Neon など他のDBはそのまま）。
 */
function resolveDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const isSupabasePooler = u.hostname.endsWith('pooler.supabase.com') && u.port === '6543';
    if (isSupabasePooler) {
      if (!u.searchParams.has('pgbouncer')) u.searchParams.set('pgbouncer', 'true');
      if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1');
      return u.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
