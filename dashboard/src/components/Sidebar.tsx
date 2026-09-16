'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const MENU = [
  { href: '/', label: 'ダッシュボード', icon: '📊' },
  { href: '/sales', label: '売上・利益', icon: '💰' },
  { href: '/ads', label: '広告分析', icon: '📣' },
  { href: '/products', label: '商品分析', icon: '📦' },
  { href: '/purchasing', label: '新商品・仕入れ', icon: '🚢' },
  { href: '/inventory', label: '在庫管理', icon: '🏬' },
  { href: '/targets', label: '目標・予実管理', icon: '🎯' },
  { href: '/tasks', label: 'タスク管理', icon: '✅' },
  { href: '/proposals', label: 'AI改善提案', icon: '💡' },
  { href: '/reports', label: 'レポート', icon: '🧾' },
  { href: '/integrations', label: 'データ連携設定', icon: '🔌' },
  { href: '/masters', label: '各種マスター管理', icon: '⚙️' },
];

const SHORTCUTS = [
  { href: '/tasks?filter=today', label: '今日のToDo' },
  { href: '/tasks?filter=open', label: '未完了タスク' },
  { href: '/proposals?tab=alerts', label: 'アラート一覧' },
  { href: '/integrations#llm', label: 'AIに質問する（未接続）' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-label="メニュー"
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-3 z-30 rounded-md bg-blue-950 px-2 py-1 text-white lg:hidden"
      >
        ☰
      </button>
      <aside
        className={`fixed inset-y-0 left-0 z-20 w-[220px] transform bg-blue-950 text-slate-200 transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-blue-900 px-4 py-4">
          <p className="text-sm font-bold text-white">Libetee</p>
          <p className="text-xs text-slate-400">経営AIダッシュボード</p>
        </div>
        <nav className="mt-2 space-y-0.5 px-2">
          {MENU.map((m) => {
            const active = pathname === m.href;
            return (
              <Link
                key={m.href}
                href={m.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] ${
                  active ? 'bg-blue-800 font-medium text-white' : 'hover:bg-blue-900'
                }`}
              >
                <span className="text-xs">{m.icon}</span>
                {m.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 border-t border-blue-900 px-4 pt-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">ショートカット</p>
          {SHORTCUTS.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              onClick={() => setOpen(false)}
              className="block rounded px-1 py-1 text-xs text-slate-400 hover:text-white"
            >
              ・{s.label}
            </Link>
          ))}
        </div>
      </aside>
    </>
  );
}
