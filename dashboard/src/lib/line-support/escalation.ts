import type { Knowledge } from './knowledge';

/**
 * 「人の確認が必要か」をコード側でも機械的に判定する。
 * AIの needs_human 判定だけに頼らない（安全・不良・返金などの見落としは許容できないため二重に見る）。
 */
export function checkEscalation(
  text: string,
  rules: Knowledge['always_human'],
): { needed: boolean; reasons: string[] } {
  const body = String(text ?? '');
  const hits = rules.keywords.filter((k) => k && body.includes(k));
  const patHits = rules.keyword_patterns.filter((p) => {
    try {
      return new RegExp(p).test(body);
    } catch {
      return false;
    }
  });
  const all = [...hits, ...patHits];
  return { needed: all.length > 0, reasons: all.length ? [`注意語: ${all.join('・')}`] : [] };
}
