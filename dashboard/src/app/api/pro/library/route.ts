// 資料庫2.0 の検索API。ログイン必須。機密種別（人事資料・契約書）は searchLibrary が権限で落とす。
// GET /api/pro/library?q=&docType=&category=&department=&tag=&owner=&updatedWithin=&sort=&drive=1
import { NextResponse } from 'next/server';
import { currentActor } from '@/lib/rbac';
import { LibrarySearchParams, searchDrive, searchLibrary, type LibraryApiResponse } from '@/lib/pro/library';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const raw = Object.fromEntries(['q', 'docType', 'category', 'department', 'tag', 'owner', 'updatedWithin', 'sort', 'limit'].map((k) => [k, url.searchParams.get(k) ?? '']));
  const parsed = LibrarySearchParams.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '検索条件が不正です' }, { status: 400 });
  const withDrive = url.searchParams.get('drive') === '1';
  const [result, drive] = await Promise.all([
    searchLibrary(parsed.data, actor),
    withDrive ? searchDrive(parsed.data.q ?? '') : Promise.resolve({ status: 'unconfigured' as const }),
  ]);
  const body: LibraryApiResponse = { ...result, drive };
  return NextResponse.json(body);
}
