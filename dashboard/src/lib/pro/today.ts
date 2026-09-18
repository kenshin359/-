// 「今日やること」（PRO ④）。ログインした本人のタスクを、朝礼と同じ優先順で並べる。
//   ①期限超過 → ②本日期限 → ③確認待ち → ④上司からの依頼 → ⑤P1の未完了 → ⑥期限3日以内
// 同じタスクは最初に該当した区分にだけ入れる（二重表示しない）。
// 本人の特定は User.kintoneName（Kintone担当者名）を優先し、無ければログイン名の前方一致（TaskBoard と同じ）。
// どちらでも特定できないときは matched=false を返し、画面は「担当者名を設定してください」と案内する（推測で埋めない）。
import { prisma } from '../prisma';
import { listTasks, type TaskItem, type TaskOptions } from '../tasks';
import { PRIORITIES } from '../tasks-constants';
import { jstDateKey } from '../metrics/format';
import type { Actor } from '../rbac';
import { teamByCode, teamOfMember, type TeamDef } from './teams';
import { addDays, greetingFor, matchesUser } from './format';

/** 「期限3日以内」の日数（docs/pro-plan.md ④「高優先」の次に見る近い期限。TaskBoard の DueChip と同じ 3日） */
export const SOON_DAYS = 3;

export type TodaySectionKey = 'overdue' | 'dueToday' | 'waiting' | 'requested' | 'p1' | 'soon';

export interface TodayTask extends TaskItem {
  /** 上司からの依頼のとき、依頼者名（ローカルタスクのみ。Kintone には依頼元項目が無い） */
  requestedBy: string | null;
  /** 自分以外の担当者のタスク（自分が依頼して確認待ちになっているもの） */
  isOthers: boolean;
}

export interface TodaySection {
  key: TodaySectionKey;
  title: string;
  hint: string;
  tasks: TodayTask[];
}

export interface TodayTeamStatus {
  code: string;
  name: string;
  open: number;
  overdue: number;
  waiting: number;
}

export interface TodayNote {
  id: string;
  body: string;
  createdAt: string; // ISO
}

export interface TodayData {
  today: string; // YYYY-MM-DD（JST）
  greeting: string;
  /** 本人をタスクの担当者に結び付けられたか */
  matched: boolean;
  /** 結び付けに使った担当者名（kintoneName または前方一致した名前） */
  matchName: string | null;
  sections: TodaySection[];
  counts: Record<TodaySectionKey, number> & { openTotal: number };
  team: TodayTeamStatus | null;
  notes: TodayNote[];
  options: TaskOptions;
  source: 'kintone' | 'local';
  notice: string | null;
}

const SECTION_META: Record<TodaySectionKey, { title: string; hint: string }> = {
  overdue: { title: '期限超過', hint: '期限を過ぎています。今日中に完了か期限の見直しを' },
  dueToday: { title: '本日期限', hint: '今日が期限' },
  waiting: { title: '確認待ち', hint: '自分が確認待ちにしたもの・自分の確認を待っているもの' },
  requested: { title: '上司からの依頼', hint: '依頼元が設定されているタスク（ローカル保存分のみ。Kintone には依頼元項目がありません）' },
  p1: { title: 'P1の未完了', hint: 'P1が終わるまでP2に着手しない' },
  soon: { title: `期限${SOON_DAYS}日以内`, hint: '次に来る期限' },
};

const rank = (t: TaskItem) => {
  const i = PRIORITIES.indexOf(t.priority as (typeof PRIORITIES)[number]);
  return i < 0 ? PRIORITIES.length : i;
};
const byPriorityThenDue = (a: TaskItem, b: TaskItem) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999');

export interface Identity {
  /** 本人と一致する担当者名（正規化済み）。空なら未特定 */
  names: string[];
  /** ログイン中ユーザーID（依頼元の照合に使う） */
  userId: string;
}

const norm = (s: string) => s.replace(/\s/g, '');

/**
 * 本人の特定。kintoneName があればそれと完全一致（空白無視）、無ければログイン名の前方一致。
 * 一致する担当者名が無ければ names は空。
 */
export function resolveIdentity(actor: Pick<Actor, 'id' | 'name' | 'kintoneName'>, assignees: string[]): Identity {
  const uniq = [...new Set(assignees.filter(Boolean))];
  if (actor.kintoneName && norm(actor.kintoneName)) {
    const k = norm(actor.kintoneName);
    const hit = uniq.filter((a) => norm(a) === k);
    // kintoneName が設定されていれば、タスクが1件も無くても「本人は特定できている」扱い
    return { names: hit.length ? hit : [actor.kintoneName], userId: actor.id };
  }
  return { names: uniq.filter((a) => matchesUser(a, actor.name)), userId: actor.id };
}

export interface RequestedInfo {
  /** ローカルタスクID → 依頼者（User.id, 表示名） */
  byTaskId: Map<string, { userId: string; name: string }>;
}

/** 純関数: 区分分け（テスト対象）。tasks は全タスク、identity は本人 */
export function buildTodaySections(
  tasks: TaskItem[],
  identity: Identity,
  today: string,
  requested: RequestedInfo = { byTaskId: new Map() },
): { sections: TodaySection[]; counts: TodayData['counts'] } {
  const mineName = new Set(identity.names.map(norm));
  const isMine = (t: TaskItem) => mineName.has(norm(t.assignee));
  const open = tasks.filter((t) => t.status !== '完了');
  const soonLimit = addDays(today, SOON_DAYS);

  const buckets: Record<TodaySectionKey, TodayTask[]> = { overdue: [], dueToday: [], waiting: [], requested: [], p1: [], soon: [] };
  const seen = new Set<string>();
  const push = (key: TodaySectionKey, t: TaskItem) => {
    const id = `${t.source}:${t.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    const req = requested.byTaskId.get(t.id);
    buckets[key].push({ ...t, requestedBy: t.source === 'local' && req ? req.name : null, isOthers: !isMine(t) });
  };

  const mine = open.filter(isMine);
  for (const t of mine) if (t.due && t.due < today) push('overdue', t);
  for (const t of mine) if (t.due === today) push('dueToday', t);
  // ③ 自分が確認待ちにしたもの ＋ 自分が依頼して確認待ちになっているもの（自分宛）
  for (const t of mine) if (t.status === '確認待ち') push('waiting', t);
  for (const t of open) {
    if (t.status !== '確認待ち' || isMine(t) || t.source !== 'local') continue;
    const req = requested.byTaskId.get(t.id);
    if (req && req.userId === identity.userId) push('waiting', t);
  }
  // ④ 上司からの依頼（依頼元が設定されている自分のタスク。ローカルのみ）
  for (const t of mine) {
    const req = t.source === 'local' ? requested.byTaskId.get(t.id) : undefined;
    if (req && req.userId !== identity.userId) push('requested', t);
  }
  for (const t of mine) if (t.priority === 'P1') push('p1', t);
  for (const t of mine) if (t.due && t.due > today && t.due <= soonLimit) push('soon', t);

  const sections: TodaySection[] = (Object.keys(buckets) as TodaySectionKey[])
    .map((key) => ({ key, ...SECTION_META[key], tasks: buckets[key].slice().sort(byPriorityThenDue) }))
    .filter((s) => s.tasks.length > 0);

  const counts = {
    overdue: buckets.overdue.length,
    dueToday: buckets.dueToday.length,
    waiting: buckets.waiting.length,
    requested: buckets.requested.length,
    p1: buckets.p1.length,
    soon: buckets.soon.length,
    openTotal: mine.length,
  };
  return { sections, counts };
}

/** 自チームの状況（未完了・期限超過・確認待ち）。所属は User.teamCode を優先、無ければ担当者名から推定 */
export function teamStatusFor(tasks: TaskItem[], def: TeamDef | undefined, today: string): TodayTeamStatus | null {
  if (!def) return null;
  const list = tasks.filter((t) => t.status !== '完了' && def.kintoneLabels.includes(t.team));
  return {
    code: def.code,
    name: def.name,
    open: list.length,
    overdue: list.filter((t) => t.due && t.due < today).length,
    waiting: list.filter((t) => t.status === '確認待ち').length,
  };
}

async function loadRequested(source: 'kintone' | 'local'): Promise<RequestedInfo> {
  const byTaskId = new Map<string, { userId: string; name: string }>();
  if (source !== 'local') return { byTaskId };
  const rows = await prisma.task.findMany({
    where: { requestedByUserId: { not: null } },
    select: { id: true, requestedByUserId: true },
  });
  if (rows.length === 0) return { byTaskId };
  const ids = [...new Set(rows.map((r) => r.requestedByUserId!))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, kintoneName: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.kintoneName || u.name]));
  for (const r of rows) byTaskId.set(r.id, { userId: r.requestedByUserId!, name: nameOf.get(r.requestedByUserId!) ?? '不明' });
  return { byTaskId };
}

export async function getTodayFor(actor: Actor, now = new Date()): Promise<TodayData> {
  const today = jstDateKey(now);
  const data = await listTasks();
  const identity = resolveIdentity(actor, data.tasks.map((t) => t.assignee));
  const matched = identity.names.length > 0;

  const [requested, noteRows] = await Promise.all([
    loadRequested(data.source),
    prisma.note.findMany({ where: { authorUserId: actor.id }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, body: true, createdAt: true } }),
  ]);

  const { sections, counts } = matched
    ? buildTodaySections(data.tasks, identity, today, requested)
    : { sections: [], counts: { overdue: 0, dueToday: 0, waiting: 0, requested: 0, p1: 0, soon: 0, openTotal: 0 } };

  const teamDef = (actor.teamCode ? teamByCode(actor.teamCode) : undefined) ?? (matched ? teamOfMember(identity.names[0]) : undefined);

  return {
    today,
    greeting: greetingFor(now),
    matched,
    matchName: matched ? identity.names[0] : null,
    sections,
    counts,
    team: teamStatusFor(data.tasks, teamDef, today),
    notes: noteRows.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() })),
    options: data.options,
    source: data.source,
    notice: data.notice,
  };
}
