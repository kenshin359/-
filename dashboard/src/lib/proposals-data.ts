// AI改善提案（/proposals）のデータ取得。Proposal テーブル（demo は「（デモ）」接頭辞で除外: src/lib/metrics/proposals.ts）。
import { prisma } from './prisma';
import { excludeDemo, isDemoProposal, parseFacts, sortProposals, summarizeProposals, type ProposalLike } from './metrics/proposals';

export interface ProposalItem extends ProposalLike {
  ruleCode: string | null;
  targetLabel: string | null;
  facts: Record<string, string>;
  period: string | null;
  dataAsOf: string | null;
  hypothesis: string | null;
  action: string | null;
  effectNote: string | null;
  statusNote: string | null;
}

export async function listProposals() {
  const rows = await prisma.proposal.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  const demoCount = rows.filter((r) => isDemoProposal(r)).length;
  const items: ProposalItem[] = excludeDemo(rows).map((r) => ({
    id: r.id,
    source: r.source,
    ruleCode: r.ruleCode,
    title: r.title,
    priority: r.priority,
    targetLabel: r.targetLabel,
    facts: parseFacts(r.facts),
    period: r.period,
    dataAsOf: r.dataAsOf ? r.dataAsOf.toISOString() : null,
    hypothesis: r.hypothesis,
    action: r.action,
    effectNote: r.effectNote,
    status: r.status,
    statusNote: r.statusNote,
    createdAt: r.createdAt.toISOString(),
  }));
  const sorted = sortProposals(items);
  return { items: sorted, summary: summarizeProposals(sorted), demoCount, llmCount: sorted.filter((p) => p.source === 'llm').length };
}
