import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * 稼働確認用（ログイン不要）。秘密の値は返さず「あるか無いか」だけを返す。
 * 例: { ok:true, db:"ok", secretSource:"env", commit:"0aae410" }
 */
export async function GET() {
  const explicit = (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || '').trim();
  const hasDb = Boolean((process.env.DATABASE_URL || '').trim());
  const secretSource = explicit ? 'env' : hasDb ? 'derived' : 'none';
  let db: 'ok' | 'error' = 'error';
  let dbError: string | undefined;
  let users: number | undefined;
  try {
    users = await prisma.user.count();
    db = 'ok';
  } catch (e) {
    dbError = e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : String(e);
  }
  return NextResponse.json({
    ok: db === 'ok' && secretSource !== 'none',
    db,
    dbError,
    users,
    secretSource,
    dbHost: hasDb ? safeHost(process.env.DATABASE_URL as string) : null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    time: new Date().toISOString(),
  });
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
