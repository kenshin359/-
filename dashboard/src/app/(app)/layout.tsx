import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { authOptions } from '@/lib/auth';
import SignOutButton from '@/components/SignOutButton';

const ROLE_JA: Record<string, string> = {
  admin: '管理者',
  editor: '編集者',
  viewer: '閲覧者',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar />
      <div className="lg:pl-[220px]">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 pl-14 lg:px-6 lg:pl-6">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-slate-800">Libetee 経営AIダッシュボード</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-slate-600">
            <span className="hidden sm:inline">
              {session.user.name}（{ROLE_JA[session.user.role] ?? session.user.role}）
            </span>
            <SignOutButton />
          </div>
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
