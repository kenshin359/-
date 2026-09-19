// 仕入れ案件（PurchaseOrder／PoLine）の集計。純関数のみ（DB取得は src/lib/purchasing-data.ts）。
// 段階は prisma/schema.prisma の status コメント（8段＋archived）。金額は 数量×単価（外貨は fxRate で円換算、レート未設定は「換算不可」）。
import type { MetricValue } from './types';

export const PO_STAGES = ['research', 'quote', 'sample', 'test_sale', 'ordered', 'producing', 'shipped', 'received', 'archived'] as const;
export type PoStage = (typeof PO_STAGES)[number];

export const PO_STAGE_JA: Record<PoStage, string> = {
  research: 'リサーチ',
  quote: '見積',
  sample: 'サンプル',
  test_sale: 'テスト販売',
  ordered: '発注済',
  producing: '生産中',
  shipped: '出荷済',
  received: '入荷済',
  archived: 'アーカイブ',
};

/** 進行中とみなす段階（入荷済・アーカイブ以外） */
export const ACTIVE_STAGES: readonly PoStage[] = PO_STAGES.filter((s) => s !== 'received' && s !== 'archived');

export interface PoLineRow {
  skuCode: string;
  skuName: string;
  qty: number;
  unitCost: number;
  currency: string;
  fxRate: number | null;
  received: boolean;
}

export interface PoRow {
  poNo: string;
  supplierName: string;
  status: string;
  assignee: string | null;
  /** YYYY-MM-DD（JST）。未設定は null */
  etaDate: string | null;
  memo: string | null;
  lines: PoLineRow[];
}

export interface PoStageCount {
  status: PoStage;
  label: string;
  count: number;
}

export interface PoEta {
  poNo: string;
  supplierName: string;
  etaDate: string;
  /** 今日からの残日数（負なら遅延） */
  daysLeft: number;
  status: string;
}

export interface PoSummary {
  byStage: PoStageCount[];
  /** status が定義外の案件（表には出すが段階集計には入れない） */
  unknownStatus: number;
  activeCount: number;
  activeQty: number;
  activeAmountJpy: MetricValue;
  upcoming: PoEta[];
  overdueCount: number;
}

export function isPoStage(s: string): s is PoStage {
  return (PO_STAGES as readonly string[]).includes(s);
}

/** 明細1行の円換算額 */
export function lineAmountJpy(l: PoLineRow): MetricValue {
  const raw = l.qty * l.unitCost;
  if (l.currency === 'JPY') return { kind: 'value', value: raw };
  if (l.fxRate && l.fxRate > 0) return { kind: 'value', value: Math.round(raw * l.fxRate) };
  return { kind: 'na', reason: `換算不可（${l.currency} のレート未設定）` };
}

/** 案件の合計円換算額。1行でも換算不可なら全体も「換算不可」 */
export function poAmountJpy(po: PoRow): MetricValue {
  let sum = 0;
  for (const l of po.lines) {
    const a = lineAmountJpy(l);
    if (a.kind === 'na') return a;
    sum += a.value;
  }
  return { kind: 'value', value: sum };
}

export function poQty(po: PoRow): number {
  return po.lines.reduce((s, l) => s + l.qty, 0);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export function summarizePurchaseOrders(rows: PoRow[], today: string): PoSummary {
  const byStage: PoStageCount[] = PO_STAGES.map((s) => ({ status: s, label: PO_STAGE_JA[s], count: 0 }));
  let unknownStatus = 0;
  let activeCount = 0;
  let activeQty = 0;
  let activeSum = 0;
  let activeNa: MetricValue | null = null;
  const upcoming: PoEta[] = [];
  let overdueCount = 0;

  for (const po of rows) {
    if (isPoStage(po.status)) byStage[PO_STAGES.indexOf(po.status)].count += 1;
    else unknownStatus += 1;

    const active = isPoStage(po.status) && ACTIVE_STAGES.includes(po.status);
    if (!active) continue;
    activeCount += 1;
    activeQty += poQty(po);
    const amt = poAmountJpy(po);
    if (amt.kind === 'na') activeNa = activeNa ?? amt;
    else activeSum += amt.value;
    if (po.etaDate) {
      const daysLeft = daysBetween(today, po.etaDate);
      if (daysLeft < 0) overdueCount += 1;
      upcoming.push({ poNo: po.poNo, supplierName: po.supplierName, etaDate: po.etaDate, daysLeft, status: po.status });
    }
  }
  upcoming.sort((a, b) => a.etaDate.localeCompare(b.etaDate) || a.poNo.localeCompare(b.poNo));

  return {
    byStage,
    unknownStatus,
    activeCount,
    activeQty,
    activeAmountJpy: activeNa ?? { kind: 'value', value: activeSum },
    upcoming,
    overdueCount,
  };
}
