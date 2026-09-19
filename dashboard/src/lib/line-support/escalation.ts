import type { Knowledge } from './knowledge';

function hits(text: string, keywords: string[], patterns: string[]): string[] {
  const body = String(text ?? '');
  const k = keywords.filter((w) => w && body.includes(w));
  const p = patterns.filter((re) => {
    try {
      return new RegExp(re).test(body);
    } catch {
      return false;
    }
  });
  return [...k, ...p];
}

/**
 * コード側の二重チェック（AIの判定だけに頼らない）。
 * - human: 安全・法的・強いクレームの語 → 必ず有人（AIは案も出さない）
 * - staff: 注文・返品・不良など個別対応の語 → 自動返信はしない（承認以上）
 */
export function checkEscalation(
  text: string,
  rules: Knowledge['always_human'],
): { needed: boolean; human: boolean; reasons: string[] } {
  const human = hits(text, rules.keywords, rules.keyword_patterns);
  const staff = hits(text, rules.staff_keywords ?? [], []);
  const reasons: string[] = [];
  if (human.length) reasons.push(`要有人語: ${human.join('・')}`);
  if (staff.length) reasons.push(`注意語: ${staff.join('・')}`);
  return { needed: reasons.length > 0, human: human.length > 0, reasons };
}
