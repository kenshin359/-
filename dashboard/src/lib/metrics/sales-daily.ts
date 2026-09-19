// 売上・利益（/sales）の集計（純関数）。月サマリーは kpi-kintone.computeMonthlyOverview を再利用し、
// ここでは日別表（前日比・日別目標・達成率）と客単価（売上明細ベース）を組み立てる。
// 出典: Kintone 毎朝KPI報告(30)（kpiDaily）／売上明細(29)（productSalesDaily・税込）。数字は取込値のみ。
import type { KpiDailyRow } from '../pro/kpi-kintone';
import type { MetricValue } from './types';
import { judgeDaily, type DailyJudgement, type DailyTarget } from './daily-targets';

const na = (reason: string): MetricValue => ({ kind: 'na', reason });
const val = (value: number): MetricValue => ({ kind: 'value', value });

export interface SalesDailyRow {
  date: string;
  day: number;
  rakuten: number;
  amazon: number;
  own: number;
  total: number;
  /** 前日比（%増減）。前日のデータが無い日は「前日なし」、前日0は「比較不可(前日0)」 */
  dayOverDay: MetricValue;
  /** イベント日加重の日別目標。目標未設定は 0 */
  target: number;
  label: string;
  weight: number;
  /** 実績 ÷ 日別目標（%） */
  achievement: MetricValue;
  judgement: DailyJudgement;
}

/**
 * 日別表。データのある日だけ（未取込の日は 0 にせず載せない）。日付昇順。
 * 前日比は「暦日で前日」の行がある場合のみ計算する（欠損日をまたいで比較しない）。
 */
export function buildSalesDaily(rows: KpiDailyRow[], targets: DailyTarget[]): SalesDailyRow[] {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDate = new Map(sorted.map((r) => [r.date, r]));
  const targetByDate = new Map(targets.map((t) => [t.date, t]));
  return sorted.map((r) => {
    const prevKey = prevDateKey(r.date);
    const prev = byDate.get(prevKey);
    let dayOverDay: MetricValue;
    if (!prev) dayOverDay = na('前日なし');
    else if (prev.salesTotal === 0) dayOverDay = na('比較不可(前日0)');
    else dayOverDay = val(((r.salesTotal - prev.salesTotal) / prev.salesTotal) * 100);
    const t = targetByDate.get(r.date);
    const target = t?.target ?? 0;
    return {
      date: r.date,
      day: Number(r.date.slice(8, 10)),
      rakuten: r.salesRakuten,
      amazon: r.salesAmazon,
      own: r.salesOwn,
      total: r.salesTotal,
      dayOverDay,
      target,
      label: t?.label ?? '',
      weight: t?.weight ?? 1,
      achievement: target > 0 ? val((r.salesTotal / target) * 100) : na('目標未設定'),
      judgement: judgeDaily(r.salesTotal, target),
    };
  });
}

/** YYYY-MM-DD の前日（UTC演算・暦日のみ） */
export function prevDateKey(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

/** 売上明細（税込）の個数・金額から 1個あたりの単価。個数0は「個数0」 */
export function unitPrice(amount: number, units: number): MetricValue {
  if (units <= 0) return na('個数0');
  return val(amount / units);
}

export interface ChannelShare {
  key: 'rakuten' | 'amazon' | 'own';
  label: string;
  amount: number;
  /** 構成比（%）。合計0は na */
  share: MetricValue;
}

/** チャネル別の構成比（合計0は「合計0」） */
export function channelShares(byChannel: { rakuten: number; amazon: number; own: number }): ChannelShare[] {
  const total = byChannel.rakuten + byChannel.amazon + byChannel.own;
  const share = (v: number): MetricValue => (total > 0 ? val((v / total) * 100) : na('合計0'));
  return [
    { key: 'rakuten', label: '楽天', amount: byChannel.rakuten, share: share(byChannel.rakuten) },
    { key: 'amazon', label: 'Amazon', amount: byChannel.amazon, share: share(byChannel.amazon) },
    { key: 'own', label: '自社サイト', amount: byChannel.own, share: share(byChannel.own) },
  ];
}
