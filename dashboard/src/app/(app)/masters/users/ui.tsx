'use client';

import { useActionState, useState } from 'react';
import {
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
  type ActionResult,
} from './actions';

const input =
  'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none';

function Message({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return (
    <p className={`text-xs ${r.ok ? 'text-emerald-600' : 'text-red-600'}`}>{r.message}</p>
  );
}

export function UserForm() {
  const [result, action, pending] = useActionState(createUserAction, null);
  return (
    <form action={action} className="mt-3 grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs text-slate-500">氏名</label>
        <input name="name" required className={input} placeholder="例: 山田 太郎" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">メールアドレス（ログインID）</label>
        <input name="email" type="email" required className={input} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">ロール</label>
        <select name="role" defaultValue="viewer" className={input}>
          <option value="admin">管理者</option>
          <option value="editor">編集者</option>
          <option value="viewer">閲覧者</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">初期パスワード（10文字以上）</label>
        <input name="password" type="password" required minLength={10} className={input} />
      </div>
      <div className="md:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-900 px-4 py-1.5 text-sm text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? '登録中…' : '登録'}
        </button>
        <Message r={result} />
      </div>
    </form>
  );
}

export function UserRowActions({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [resetResult, resetAction, resetPending] = useActionState(resetPasswordAction, null);
  const [delResult, delAction, delPending] = useActionState(deleteUserAction, null);

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
        >
          パスワード変更
        </button>
        {!isSelf && (
          <form
            action={delAction}
            onSubmit={(e) => {
              if (!confirm('このユーザーを削除します。よろしいですか？')) e.preventDefault();
            }}
          >
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              disabled={delPending}
              className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              削除
            </button>
          </form>
        )}
      </div>
      {open && (
        <form action={resetAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          <input
            name="password"
            type="password"
            minLength={10}
            required
            placeholder="新しいパスワード（10文字以上）"
            className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={resetPending}
            className="rounded bg-blue-900 px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            変更
          </button>
        </form>
      )}
      <Message r={resetResult} />
      <Message r={delResult} />
    </div>
  );
}
