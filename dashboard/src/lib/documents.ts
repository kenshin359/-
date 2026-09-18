// 資料庫: Googleドライブ等の資料リンクを、カテゴリ・部署付きで管理する（本文は保存しない）。
import { z } from 'zod';
import { prisma } from './prisma';

// 初期カテゴリ（要確認: business.md 9章。運用に合わせて増やす）
export const DOC_CATEGORIES = ['全社共有', '営業・EC', '広告', 'CS', '商品・仕入れ', '総務・管理', '経営'] as const;
export const DOC_DEPARTMENTS = ['全社', 'CS', '広告', 'LP', 'SNS', 'TikTok', 'O2', '韓国', 'ユニONA', '社長室', '人事・管理', '経営'];

export const DocumentInput = z.object({
  title: z.string().trim().min(1, '資料名を入力してください').max(120, '資料名は120文字以内'),
  category: z.enum(DOC_CATEGORIES, { message: 'カテゴリを選んでください' }),
  department: z.string().trim().max(40).default(''),
  url: z
    .string()
    .trim()
    .url('URLの形式が正しくありません')
    .refine((u) => u.startsWith('https://'), 'https:// で始まるURLを入力してください'),
  note: z.string().trim().max(500).default(''),
});
export type DocumentInputType = z.infer<typeof DocumentInput>;

export type DocKind = 'folder' | 'doc' | 'sheet' | 'slide' | 'form' | 'pdf' | 'link';

/** URLから資料の種類を判定（アイコン出し分け用。判定できなければ link） */
export function docKind(url: string): DocKind {
  try {
    const u = new URL(url);
    const h = u.hostname;
    const p = u.pathname;
    if (h === 'drive.google.com' && p.includes('/folders/')) return 'folder';
    if (h === 'docs.google.com') {
      if (p.startsWith('/document')) return 'doc';
      if (p.startsWith('/spreadsheets')) return 'sheet';
      if (p.startsWith('/presentation')) return 'slide';
      if (p.startsWith('/forms')) return 'form';
    }
    if (p.toLowerCase().endsWith('.pdf')) return 'pdf';
    if (h === 'drive.google.com') return 'doc';
    return 'link';
  } catch {
    return 'link';
  }
}

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  folder: 'フォルダ',
  doc: 'ドキュメント',
  sheet: 'スプレッドシート',
  slide: 'スライド',
  form: 'フォーム',
  pdf: 'PDF',
  link: 'リンク',
};

export interface DocumentItem {
  id: string;
  title: string;
  category: string;
  department: string;
  url: string;
  note: string;
  ownerName: string;
  ownerId: string | null;
  kind: DocKind;
  host: string;
  updatedAt: string;
  createdAt: string;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function listDocuments(): Promise<DocumentItem[]> {
  const rows = await prisma.document.findMany({ orderBy: [{ updatedAt: 'desc' }] });
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    department: d.department ?? '',
    url: d.url,
    note: d.note ?? '',
    ownerName: d.ownerName ?? '',
    ownerId: d.ownerId,
    kind: docKind(d.url),
    host: host(d.url),
    updatedAt: d.updatedAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function createDocument(input: DocumentInputType, owner: { id: string; name: string }) {
  return prisma.document.create({
    data: {
      title: input.title,
      category: input.category,
      department: input.department || null,
      url: input.url,
      note: input.note || null,
      ownerId: owner.id,
      ownerName: owner.name,
    },
  });
}

export async function updateDocument(id: string, input: DocumentInputType) {
  return prisma.document.update({
    where: { id },
    data: {
      title: input.title,
      category: input.category,
      department: input.department || null,
      url: input.url,
      note: input.note || null,
    },
  });
}

export async function deleteDocument(id: string) {
  return prisma.document.delete({ where: { id } });
}
