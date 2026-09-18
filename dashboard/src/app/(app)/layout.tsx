import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import SignOutButton from '@/components/SignOutButton';
import ModeSwitch from '@/components/ModeSwitch';
import CommandPalette from '@/components/CommandPalette';
import QuickActions from '@/components/QuickActions';
import { currentActor, canSeeCompanyWide, LEVEL_JA } from '@/lib/rbac';
import { getUiMode } from '@/lib/ui-mode';

const ROLE_JA: Record<string, string> = {
  admin: '管理者',
  editor: '編集者',
  viewer: '閲覧者',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [actor, mode] = await Promise.all([currentActor(), getUiMode()]);
  if (!actor) redirect('/login');
  const staffOnly = !canSeeCompanyWide(actor.level);
  const canWrite = actor.role === 'admin' || actor.role === 'editor';

  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar mode={mode} staffOnly={staffOnly} />
      <div className="lg:pl-[220px]">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 pl-14 lg:px-6 lg:pl-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="hidden truncate text-sm font-bold text-slate-800 md:block">Libetee 経営AIダッシュボード</h1>
            <ModeSwitch mode={mode} />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
            <CommandPalette mode={mode} staffOnly={staffOnly} />
            {mode === 'pro' && canWrite && <QuickActions />}
            {mode === 'pro' && (
              <Link
                href="/pro/alerts"
                aria-label="アラート"
                title="アラート"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <Bell size={16} aria-hidden />
              </Link>
            )}
            <span className="hidden sm:inline" title={`権限: ${LEVEL_JA[actor.level]}`}>
              {actor.name}（{ROLE_JA[actor.role] ?? actor.role}）
            </span>
            <SignOutButton />
          </div>
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
