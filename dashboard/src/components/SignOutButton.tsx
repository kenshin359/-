'use client';

import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
    >
      サインアウト
    </button>
  );
}
