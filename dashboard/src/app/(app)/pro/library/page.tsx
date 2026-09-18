// PRO ⑥ 資料庫2.0（横断検索・タグ・Drive任意）。初回表示はサーバーで検索し、以後は /api/pro/library を叩く。
import { canWrite } from '@/lib/auth';
import { canSeeConfidential, requireActor } from '@/lib/rbac';
import { driveConfigured, searchLibrary } from '@/lib/pro/library';
import LibraryView from './LibraryView';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 200) : '';
  const tag = typeof sp.tag === 'string' ? sp.tag.slice(0, 30) : '';
  const initial = await searchLibrary({ q, tag }, actor);
  return (
    <LibraryView
      initial={initial}
      initialQuery={q}
      initialTag={tag}
      canEdit={canWrite(actor.role)}
      canConfidential={canSeeConfidential(actor.level)}
      driveOn={driveConfigured()}
    />
  );
}
