import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ROLE_JA } from '@/lib/users';
import { UserForm, UserRowActions } from './ui';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'admin') {
    return (
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-800">ユーザー管理</h1>
        <p className="mt-2 text-sm text-red-600">この画面は管理者のみ利用できます。</p>
      </div>
    );
  }
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-800">ユーザー管理</h1>
        <p className="mt-1 text-xs text-slate-500">
          ログインIDはメールアドレスです。管理者=全操作、編集者=取込・登録編集、閲覧者=閲覧とCSV出力のみ。
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="py-2 pr-3">氏名</th>
                <th className="py-2 pr-3">メールアドレス（ログインID）</th>
                <th className="py-2 pr-3">ロール</th>
                <th className="py-2 pr-3">登録日</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3 font-medium text-slate-800">
                    {u.name}
                    {u.id === session.user.id && (
                      <span className="ml-1 text-[10px] text-slate-400">（自分）</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{u.email}</td>
                  <td className="py-2 pr-3">
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                      {ROLE_JA[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">
                    {u.createdAt.toLocaleDateString('ja-JP')}
                  </td>
                  <td className="py-2">
                    <UserRowActions userId={u.id} isSelf={u.id === session.user.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">ユーザーを追加</h2>
        <UserForm />
      </div>
    </div>
  );
}
