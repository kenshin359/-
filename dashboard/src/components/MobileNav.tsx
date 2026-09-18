'use client';

// PRO のモバイル下部ナビ（今日・アラート・部署・タスク・報告）。PC では出さない。
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sun, Bell, Building2, KanbanSquare, NotebookPen } from 'lucide-react';

const ITEMS = [
  { href: '/pro/today', label: '今日', icon: Sun },
  { href: '/pro/alerts', label: 'アラート', icon: Bell },
  { href: '/pro/teams', label: '部署', icon: Building2 },
  { href: '/pro/tasks', label: 'タスク', icon: KanbanSquare },
  { href: '/pro/reports', label: '報告', icon: NotebookPen },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="モバイルメニュー"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + '/');
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${active ? 'text-blue-900' : 'text-slate-500'}`}
          >
            <Icon size={18} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
