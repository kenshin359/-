'use client';

import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn('credentials', { email, password, redirect: false });
    setBusy(false);
    if (res?.error) {
      setError('メールアドレスまたはパスワードが違います');
      return;
    }
    router.push(params.get('callbackUrl') ?? '/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <label className="mb-1 block text-sm text-slate-600">メールアドレス</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm text-slate-600">パスワード</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-blue-900 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
      >
        {busy ? 'サインイン中…' : 'サインイン'}
      </button>
      <div className="rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-500">
        デモアカウント:
        <br />admin@demo.local / admin1234（管理者）
        <br />editor@demo.local / editor1234（編集者）
        <br />viewer@demo.local / viewer1234（閲覧者）
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-blue-950">Libetee 経営AIダッシュボード</h1>
        <p className="mt-1 text-sm text-slate-500">サインインしてください</p>
      </div>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
