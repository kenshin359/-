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
  ChevronDown,
  Crosshair,
  type LucideIcon,
} from 'lucide-react';
import { PRO_NAV } from './pro-nav';
import type { UiMode } from '@/lib/ui-mode';

type Item = { href: string; label: string; icon: LucideIcon };

// STANDARD（現行のまま。変更しない）
const MENU: Item[] = [
  { href: '/', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/sales', label: '売上・利益', icon: CircleDollarSign },
  { href: '/ads', label: '広告分析', icon: Megaphone },
  { href: '/ads/cpa', label: '合算CPA管理', icon: Crosshair },
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

function NavLink({ item, active, strong }: { item: Item; active: boolean; strong?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors ${
        active
          ? 'bg-blue-800 font-medium text-white shadow-sm shadow-blue-950/40'
          : strong
            ? 'text-blue-100/90 hover:bg-blue-900 hover:text-white'
            : 'text-blue-100/70 hover:bg-blue-900 hover:text-white'
      }`}
    >
      <Icon size={15} strokeWidth={active ? 2.25 : 1.75} aria-hidden className="shrink-0" />
      {item.label}
    </Link>
  );
}

export default function Sidebar({ mode = 'standard', staffOnly = false }: { mode?: UiMode; staffOnly?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [showStandard, setShowStandard] = useState(false);

  // 画面遷移で自動的に閉じる（モバイル）
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => pathname === href || (href !== '/' && href !== '/pro' && pathname.startsWith(href + '/'));
  const proItems = PRO_NAV.filter((i) => !staffOnly || i.staff);

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
          <p className="text-[11px] text-blue-200/80">
            経営AIダッシュボード{mode === 'pro' && <span className="ml-1 rounded bg-blue-800 px-1 py-px text-[10px] font-semibold text-white">PRO</span>}
          </p>
        </div>
        <nav aria-label="メインメニュー" className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {mode === 'pro' ? (
            <>
              {proItems.map((m) => (
                <NavLink key={m.href} item={m} active={isActive(m.href)} strong />
              ))}
              <button
                type="button"
                onClick={() => setShowStandard(!showStandard)}
                aria-expanded={showStandard}
                className="mt-3 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-medium text-blue-200/70 hover:text-white"
              >
                STANDARD の画面
                <ChevronDown size={13} aria-hidden className={`transition-transform ${showStandard ? 'rotate-180' : ''}`} />
              </button>
              {showStandard && MENU.map((m) => <NavLink key={m.href} item={m} active={isActive(m.href)} />)}
            </>
          ) : (
            MENU.map((m) => <NavLink key={m.href} item={m} active={isActive(m.href)} strong />)
          )}
        </nav>
        {mode === 'standard' && (
          <div className="border-t border-blue-900 px-4 py-3">
            <p className="mb-1 text-[11px] font-medium text-blue-200/70">ショートカット</p>
            {SHORTCUTS.map((s) => (
              <Link key={s.label} href={s.href} className="block rounded px-1 py-1 text-xs text-blue-100/80 hover:text-white">
                {s.label}
              </Link>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}
