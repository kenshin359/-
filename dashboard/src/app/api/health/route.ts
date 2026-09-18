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
  try {
    await prisma.user.count();
    db = 'ok';
  } catch (e) {
    // 接続先やユーザー数など内部情報はログイン不要APIでは返さない（分類だけ返す）
    const m = e instanceof Error ? e.message : String(e);
    dbError = /P1001|reach/i.test(m) ? 'unreachable' : /P1000|auth|password/i.test(m) ? 'auth' : 'error';
  }
  return NextResponse.json({
    ok: db === 'ok' && secretSource !== 'none',
    db,
    dbError,
    secretSource,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    time: new Date().toISOString(),
  });
}
