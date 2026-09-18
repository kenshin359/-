'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CircleDollarSign,
  Megaphone,
  Package,
  Ship,
  Warehouse,
  Target,
  CheckSquare,
  Lightbulb,
  FileText,
  FolderOpen,
  Plug,
  Settings,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';

type Item = { href: string; label: string; icon: LucideIcon };

const MENU: Item[] = [
  { href: '/', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/sales', label: '売上・利益', icon: CircleDollarSign },
  { href: '/ads', label: '広告分析', icon: Megaphone },
  { href: '/products', label: '商品分析', icon: Package },
  { href: '/purchasing', label: '新商品・仕入れ', icon: Ship },
  { href: '/inventory', label: '在庫管理', icon: Warehouse },
  { href: '/targets', label: '目標・予実管理', icon: Target },
  { href: '/tasks', label: 'タスク管理', icon: CheckSquare },
  { href: '/documents', label: '資料庫', icon: FolderOpen },
  { href: '/proposals', label: 'AI改善提案', icon: Lightbulb },
  { href: '/reports', label: 'レポート', icon: FileText },
  { href: '/integrations', label: 'データ連携設定', icon: Plug },
  { href: '/masters', label: '各種マスター管理', icon: Settings },
];

const SHORTCUTS = [
  { href: '/tasks?filter=today', label: '今日のToDo' },
  { href: '/tasks?filter=overdue', label: '期限超過のタスク' },
  { href: '/proposals?tab=alerts', label: 'アラート一覧' },
  { href: '/integrations#llm', label: 'AIに質問する（未接続）' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 画面遷移で自動的に閉じる（モバイル）
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
        aria-expanded={open}
        aria-controls="app-sidebar"
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-2.5 z-30 inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-950 text-white shadow-md shadow-blue-950/30 lg:hidden"
      >
        {open ? <X size={16} aria-hidden /> : <Menu size={16} aria-hidden />}
      </button>
      {open && (
        <button
          type="button"
          aria-label="メニューを閉じる"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-10 bg-slate-900/40 lg:hidden"
        />
      )}
      <aside
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-20 flex w-[220px] transform flex-col bg-blue-950 text-blue-100 transition-transform duration-200 ease-out lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-blue-900 px-4 py-4">
          <p className="text-sm font-bold tracking-wide text-white">Libetee</p>
          <p className="text-[11px] text-blue-200/80">経営AIダッシュボード</p>
        </div>
        <nav aria-label="メインメニュー" className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {MENU.map((m) => {
            const active = pathname === m.href || (m.href !== '/' && pathname.startsWith(m.href + '/'));
            const Icon = m.icon;
            return (
              <Link
                key={m.href}
                href={m.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors ${
                  active
                    ? 'bg-blue-800 font-medium text-white shadow-sm shadow-blue-950/40'
                    : 'text-blue-100/90 hover:bg-blue-900 hover:text-white'
                }`}
              >
                <Icon size={15} strokeWidth={active ? 2.25 : 1.75} aria-hidden className="shrink-0" />
                {m.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-blue-900 px-4 py-3">
          <p className="mb-1 text-[11px] font-medium text-blue-200/70">ショートカット</p>
          {SHORTCUTS.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="block rounded px-1 py-1 text-xs text-blue-100/80 hover:text-white"
            >
              {s.label}
            </Link>
          ))}
        </div>
      </aside>
    </>
  );
}
