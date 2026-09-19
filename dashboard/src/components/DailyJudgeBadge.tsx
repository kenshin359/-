// 日次判定バッジ（business.md §6: 売上÷日次目標 ≥1.0 🟢好調 / ≥0.7 🟡まずまず / 未満 🔴要改善）。/sales と /targets で共用。
import { DAILY_JUDGE_JA, type DailyJudgement } from '@/lib/metrics/daily-targets';

const STYLE: Record<DailyJudgement, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  na: 'bg-slate-100 text-slate-500',
};

export default function DailyJudgeBadge({ j }: { j: DailyJudgement }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STYLE[j]}`}>{DAILY_JUDGE_JA[j]}</span>;
}
