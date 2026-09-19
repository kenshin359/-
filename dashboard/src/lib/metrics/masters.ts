// マスター件数の集計（実データ／デモの内訳）。純関数のみ（DB取得は src/lib/masters-data.ts）。
// マスター系テーブル（Channel／Media／Warehouse／Supplier／ProductSeries／Sku／SkuCost／User）には demo 列が無い。
// デモ判定は prisma/seed.ts が作る行の規則で行う（推測ではなく seed の定義そのもの）:
//   - code が demo で始まる（ProductSeries: demo-sc-s 等、Sku: demo-sc-s-BK 等）
//   - Warehouse code 'main'（メイン倉庫）、Supplier code 'sup-a'（デモ仕入先A）
//   - User の email が @demo.local
//   - name が「デモ」で始まる
// Channel（rakuten/amazon/own）と Media（meta_travel/meta_catalog/rpp/amazon_ads/google）は業務上の実コードなので実データ扱い。

export const MASTER_KINDS = ['channel', 'media', 'warehouse', 'supplier', 'series', 'sku', 'skuCost', 'user'] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];

export const MASTER_KIND_JA: Record<MasterKind, string> = {
  channel: 'チャネル',
  media: '広告媒体',
  warehouse: '倉庫',
  supplier: '仕入先',
  series: '商品シリーズ',
  sku: 'SKU',
  skuCost: '原価（有効期間付き）',
  user: 'ユーザー',
};

/** prisma/seed.ts が固定コードで作るデモ行 */
export const SEED_DEMO_CODES: Partial<Record<MasterKind, readonly string[]>> = {
  warehouse: ['main'],
  supplier: ['sup-a'],
};

export interface MasterRowLike {
  code?: string | null;
  name?: string | null;
  email?: string | null;
}

export function isDemoMaster(kind: MasterKind, row: MasterRowLike): boolean {
  if (kind === 'user') return (row.email ?? '').toLowerCase().endsWith('@demo.local');
  const code = row.code ?? '';
  if (code.toLowerCase().startsWith('demo')) return true;
  if (SEED_DEMO_CODES[kind]?.includes(code)) return true;
  if ((row.name ?? '').startsWith('デモ')) return true;
  return false;
}

export interface MasterCount {
  kind: MasterKind;
  label: string;
  total: number;
  real: number;
  demo: number;
}

export function countMasters(kind: MasterKind, rows: MasterRowLike[]): MasterCount {
  let demo = 0;
  for (const r of rows) if (isDemoMaster(kind, r)) demo += 1;
  return { kind, label: MASTER_KIND_JA[kind], total: rows.length, real: rows.length - demo, demo };
}
