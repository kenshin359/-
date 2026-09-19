// PRO の権限（5段階）。既存の role（admin/editor/viewer）は書込可否、level は「何を見られるか」を決める。
// UIの出し分けだけに頼らず、Server Action / Route Handler で必ずこのモジュールを通す。
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { prisma } from './prisma';

export const LEVELS = ['ceo', 'director', 'manager', 'leader', 'staff'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_JA: Record<Level, string> = {
  ceo: '代表',
  director: '取締役',
  manager: '管理職',
  leader: 'リーダー',
  staff: '一般社員',
};

const RANK: Record<Level, number> = { ceo: 0, director: 1, manager: 2, leader: 3, staff: 4 };

export function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}

/** a が b 以上の権限か */
export function atLeast(a: Level, b: Level): boolean {
  return RANK[a] <= RANK[b];
}

/** 機密（粗利・営業利益・人事・給与）を見られるか: 管理職以上 */
export function canSeeConfidential(level: Level): boolean {
  return atLeast(level, 'manager');
}

/** 部署横断（全社）の数字を見られるか: リーダー以上。一般社員は自分と自チームのみ */
export function canSeeCompanyWide(level: Level): boolean {
  return atLeast(level, 'leader');
}

export interface Actor {
  id: string;
  name: string;
  role: string; // admin | editor | viewer
  level: Level;
  teamCode: string | null;
  kintoneName: string | null;
}

/** ログイン中のユーザーを DB から引き、権限情報を揃えて返す（未ログインは null） */
export async function currentActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, role: true, level: true, teamCode: true, kintoneName: true },
  });
  if (!u) return null;
  // admin は常に経営者相当（初期管理者が機密を見られなくなるのを防ぐ）
  const level: Level = u.role === 'admin' ? 'ceo' : isLevel(u.level) ? u.level : 'staff';
  return { id: u.id, name: u.name, role: u.role, level, teamCode: u.teamCode, kintoneName: u.kintoneName };
}

export async function requireActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a) throw new Error('ログインが必要です');
  return a;
}

/** 指定レベル以上でなければ例外（Server Action / API で使う） */
export async function requireLevel(min: Level): Promise<Actor> {
  const a = await requireActor();
  if (!atLeast(a.level, min)) throw new Error(`${LEVEL_JA[min]}以上のみ操作できます`);
  return a;
}

/** 機密フィールドを落とす（APIレベルの制御）。keys に挙げた項目を null にする */
export function redactConfidential<T extends Record<string, unknown>>(obj: T, level: Level, keys: (keyof T)[]): T {
  if (canSeeConfidential(level)) return obj;
  const out = { ...obj };
  for (const k of keys) (out as Record<string, unknown>)[k as string] = null;
  return out;
}
