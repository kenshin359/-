import knowledgeJson from '../../../config/line-ai-knowledge.json';

export type Knowledge = {
  company: { name: string; brand: string; channels: string[] };
  bot: { name: string; greeting: string; fallback: string; handoff: string };
  facts: Record<string, string>;
  products: { group: string; sizes: string[]; colors: string[]; note?: string }[];
  unknown: Record<string, string>;
  always_human: { keywords: string[]; keyword_patterns: string[] };
  style: { max_chars: number; tone: string; phrases: string[] };
};

/** config/line-ai-knowledge.json（AIが事実として答えてよい範囲）。`_` で始まるキーは説明文なので除外する。 */
export function loadKnowledge(): Knowledge {
  const raw = knowledgeJson as unknown as Knowledge & Record<string, unknown>;
  const strip = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
  return {
    company: raw.company,
    bot: raw.bot,
    facts: strip(raw.facts),
    products: raw.products,
    unknown: strip(raw.unknown),
    always_human: {
      keywords: raw.always_human.keywords ?? [],
      keyword_patterns: raw.always_human.keyword_patterns ?? [],
    },
    style: raw.style,
  };
}
