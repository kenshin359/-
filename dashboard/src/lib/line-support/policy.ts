import { prisma } from '@/lib/prisma';
import type { Mode } from './categories';

/** 運用の閾値（Setting テーブル。管理画面から変更） */
export const POLICY_KEYS = {
  csAutoMin: 'lineSupport.csAutoMin', // AUTO モードで自動返信してよい確信度の下限（0-100）
} as const;

export type Policy = { csAutoMin: number };
export const DEFAULT_POLICY: Policy = { csAutoMin: 85 };

export async function loadPolicy(): Promise<Policy> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: POLICY_KEYS.csAutoMin } });
    const n = Number(row?.value);
    return { csAutoMin: Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_POLICY.csAutoMin };
  } catch {
    return DEFAULT_POLICY;
  }
}

export type Action = 'auto_reply' | 'approval' | 'human';

/**
 * AIの判定とカテゴリの運用モードから、実際に取る行動を決める（純関数・テスト対象）。
 * - HUMAN_ONLY／レベル3／安全・法的の注意語 → 有人（AIの案は出さない）
 * - AUTO かつ レベル1 かつ 確信度≥閾値 かつ 根拠（KB参照）あり → 自動返信
 * - それ以外 → 承認（回答案をスタッフへ）
 * 「事実の捏造禁止」を構造で担保するため、根拠の無い回答案は自動返信の対象にしない。
 */
export function decideAction(input: {
  mode: Mode;
  level: number;
  confidence: number;
  humanRule: boolean;
  kbRefs: string[];
  policy: Policy;
}): Action {
  if (input.mode === 'HUMAN_ONLY' || input.level >= 3 || input.humanRule) return 'human';
  if (input.mode === 'AUTO' && input.level === 1 && input.confidence >= input.policy.csAutoMin && input.kbRefs.length > 0) {
    return 'auto_reply';
  }
  return 'approval';
}
