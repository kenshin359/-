import { prisma } from '@/lib/prisma';

/** 運用モード: AUTO=条件を満たせば自動返信 / APPROVAL=回答案をスタッフが承認して送信 / HUMAN_ONLY=AIは案を出さず有人 */
export const MODES = ['AUTO', 'APPROVAL', 'HUMAN_ONLY'] as const;
export type Mode = (typeof MODES)[number];
export const MODE_JA: Record<Mode, string> = { AUTO: '自動返信', APPROVAL: '承認して送信', HUMAN_ONLY: '有人のみ' };

export type Category = {
  code: string;
  name: string;
  description: string | null;
  level: number; // 1=自動返信可能 2=条件確認後回答 3=有人
  mode: Mode;
  sortOrder: number;
  active: boolean;
};

/**
 * 初期カテゴリ（依頼書 §5 の17種）。テーブルが空のときだけ投入する。以後は管理画面で変更。
 * Phase 1 は L1/L2 も APPROVAL（承認必須）、L3 は HUMAN_ONLY。
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { code: 'product_spec', name: '商品仕様', description: 'サイズ・容量・カラー・素材・機能などの仕様', level: 1, mode: 'APPROVAL', sortOrder: 10, active: true },
  { code: 'usage', name: '商品の使い方', description: '操作方法・お手入れ・使い方の質問', level: 1, mode: 'APPROVAL', sortOrder: 20, active: true },
  { code: 'shipping', name: '配送', description: '配送状況・配送方法・送料', level: 2, mode: 'APPROVAL', sortOrder: 30, active: true },
  { code: 'delivery_date', name: '納期', description: 'いつ届くか・発送予定', level: 2, mode: 'APPROVAL', sortOrder: 40, active: true },
  { code: 'order_check', name: '注文確認', description: '注文内容・注文状況の確認', level: 2, mode: 'APPROVAL', sortOrder: 50, active: true },
  { code: 'cancel', name: 'キャンセル', description: '注文のキャンセル希望', level: 2, mode: 'APPROVAL', sortOrder: 60, active: true },
  { code: 'return', name: '返品', description: '返品希望・返品条件', level: 2, mode: 'APPROVAL', sortOrder: 70, active: true },
  { code: 'exchange', name: '交換', description: '交換希望・交換条件', level: 2, mode: 'APPROVAL', sortOrder: 80, active: true },
  { code: 'warranty', name: '保証', description: '永久保証・保証範囲・部品', level: 2, mode: 'APPROVAL', sortOrder: 90, active: true },
  { code: 'initial_defect', name: '初期不良', description: '届いた直後の不具合・破損', level: 2, mode: 'APPROVAL', sortOrder: 100, active: true },
  { code: 'malfunction', name: '故障', description: '使用中の故障・不具合', level: 2, mode: 'APPROVAL', sortOrder: 110, active: true },
  { code: 'receipt', name: '領収書', description: '領収書・請求書・インボイス', level: 2, mode: 'APPROVAL', sortOrder: 120, active: true },
  { code: 'stock', name: '在庫', description: '在庫の有無・再入荷', level: 2, mode: 'APPROVAL', sortOrder: 130, active: true },
  { code: 'complaint', name: 'クレーム', description: '強い不満・苦情', level: 3, mode: 'HUMAN_ONLY', sortOrder: 140, active: true },
  { code: 'legal', name: '法的問い合わせ', description: '法律・消費者センター・弁護士に関する話題', level: 3, mode: 'HUMAN_ONLY', sortOrder: 150, active: true },
  { code: 'safety', name: '安全性', description: '発煙・発火・けが・事故など安全に関わる内容', level: 3, mode: 'HUMAN_ONLY', sortOrder: 160, active: true },
  { code: 'other', name: 'その他', description: '上記に当てはまらないもの・挨拶・雑談', level: 2, mode: 'APPROVAL', sortOrder: 999, active: true },
];

function isMode(v: unknown): v is Mode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

/** テーブルが空なら初期カテゴリを投入し、有効なカテゴリを並び順で返す。DBが読めなければ既定値で動く */
export async function loadCategories(): Promise<Category[]> {
  try {
    const count = await prisma.inquiryCategory.count();
    if (count === 0) {
      await prisma.inquiryCategory.createMany({ data: DEFAULT_CATEGORIES });
    }
    const rows = await prisma.inquiryCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      level: r.level,
      mode: isMode(r.mode) ? r.mode : 'APPROVAL',
      sortOrder: r.sortOrder,
      active: r.active,
    }));
  } catch (e) {
    console.error('[line-ai] カテゴリ読込失敗（既定値で継続）:', e instanceof Error ? e.message : e);
    return DEFAULT_CATEGORIES;
  }
}

export function findCategory(cats: Category[], code: string | null | undefined): Category {
  return cats.find((c) => c.code === code) ?? cats.find((c) => c.code === 'other') ?? DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
}
