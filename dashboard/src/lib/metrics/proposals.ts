// AI改善提案（/proposals）の純関数。Proposal テーブル（source rule|llm / status open|adopted|held|rejected）。
// Proposal に demo 列は無いため、デモ除外はシード（prisma/seed.ts）の命名規約「（デモ）」接頭辞で判定する。
// LLM由来の提案（source='llm'）は生成器が未接続（画面に「未接続」と明記し、成功と偽らない）。

export const PROPOSAL_STATUSES = ['open', 'adopted', 'held', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_JA: Record<ProposalStatus, string> = {
  open: '未対応',
  adopted: '採用',
  held: '保留',
  rejected: '却下',
};

export const PROPOSAL_SOURCE_JA: Record<string, string> = { rule: 'ルール', llm: 'LLM' };

/** シードのデモ表記（タスク・提案で共通） */
export const DEMO_PREFIX = '（デモ）';

export function isProposalStatus(v: unknown): v is ProposalStatus {
  return typeof v === 'string' && (PROPOSAL_STATUSES as readonly string[]).includes(v);
}

export function isDemoProposal(p: { title: string }): boolean {
  return p.title.trim().startsWith(DEMO_PREFIX);
}

export interface ProposalLike {
  id: string;
  source: string;
  title: string;
  priority: number;
  status: string;
  createdAt: string; // ISO
}

/** 根拠（facts）の JSON を表示用の key→値 に。壊れた JSON は「根拠」欄に原文をそのまま出す */
export function parseFacts(raw: string): Record<string, string> {
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = typeof val === 'string' ? val : JSON.stringify(val);
      }
      return out;
    }
  } catch {
    /* 下で原文を返す */
  }
  return raw.trim() ? { 根拠: raw } : {};
}

/** デモ（「（デモ）」接頭辞）を除外する */
export function excludeDemo<T extends { title: string }>(list: T[]): T[] {
  return list.filter((p) => !isDemoProposal(p));
}

/** 状態別の件数（不明な状態は other に数える） */
export function summarizeProposals(list: { status: string }[]): Record<ProposalStatus, number> & { total: number; other: number } {
  const out = { open: 0, adopted: 0, held: 0, rejected: 0, total: 0, other: 0 };
  for (const p of list) {
    out.total++;
    if (isProposalStatus(p.status)) out[p.status]++;
    else out.other++;
  }
  return out;
}

const STATUS_ORDER: Record<ProposalStatus, number> = { open: 0, held: 1, adopted: 2, rejected: 3 };

/** 表示順: 未対応 → 保留 → 採用 → 却下、同じ状態は優先度（小さいほど重要）→ 新しい順 */
export function sortProposals<T extends ProposalLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const sa = isProposalStatus(a.status) ? STATUS_ORDER[a.status] : 9;
    const sb = isProposalStatus(b.status) ? STATUS_ORDER[b.status] : 9;
    if (sa !== sb) return sa - sb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}
