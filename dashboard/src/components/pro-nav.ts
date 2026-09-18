// PRO のメニュー定義（サイドバー・⌘K・モバイル下部ナビで共用）。
// 並びは「会社の状態 → 自分の今日 → 異常 → 部署 → 仕事 → 情報」の順。
import {
  Activity,
  Bell,
  Building2,
  CheckSquare,
  FolderSearch,
  Gauge,
  KanbanSquare,
  MessageSquare,
  NotebookPen,
  Settings2,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface ProNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 一般社員にも見せるか */
  staff: boolean;
  keywords?: string[];
}

export const PRO_NAV: ProNavItem[] = [
  { href: '/pro', label: '経営ダッシュボード', icon: Gauge, staff: false, keywords: ['会社', 'KPI', '売上'] },
  { href: '/pro/today', label: '今日やること', icon: Sun, staff: true, keywords: ['today', '自分'] },
  { href: '/pro/alerts', label: 'アラート', icon: Bell, staff: true, keywords: ['異常', '期限超過'] },
  { href: '/pro/teams', label: '部署', icon: Building2, staff: true, keywords: ['チーム', '部門'] },
  { href: '/pro/tasks', label: 'タスク2.0', icon: KanbanSquare, staff: true, keywords: ['ボトルネック', 'プロジェクト'] },
  { href: '/pro/kpi', label: 'KPI', icon: Activity, staff: false, keywords: ['指標', '改善'] },
  { href: '/pro/reports', label: '報告', icon: NotebookPen, staff: true, keywords: ['日報', '週報', '中間報告'] },
  { href: '/pro/library', label: '資料庫2.0', icon: FolderSearch, staff: true, keywords: ['検索', 'ドライブ'] },
  { href: '/pro/people', label: '社員・組織', icon: Users, staff: false, keywords: ['名簿', '権限'] },
  { href: '/pro/line', label: 'LINE監査役', icon: MessageSquare, staff: false, keywords: ['追いかけ', 'スケジュール'] },
  { href: '/pro/settings', label: 'PRO設定', icon: Settings2, staff: true, keywords: ['閾値', '通知'] },
];

export const STANDARD_LINKS = [
  { href: '/tasks', label: 'タスク管理（STANDARD）', icon: CheckSquare },
];
