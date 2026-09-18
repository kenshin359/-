// LINE監査役のサーバー側ロジック（webhook / cron / 管理画面アクションで共用）。
// - 依頼→FollowUp 作成、完了報告→FollowUp 照合、追いかけリマインド、定時投稿の本文組み立て。
// - 監査ログは AuditLog（action は 'line.' で始める）。本文の全文は保存せず、タイトル（≤80文字）とIDだけ。
import { prisma } from '../prisma';
import { listTasks, type TaskItem } from '../tasks';
import { jstDateKey } from '../metrics/format';
import { teamByCode, TEAM_DEFS } from '../pro/teams';
import { fmtDue } from '../pro/format';
import { extract, isCompletion, similarity, type Extracted } from './extract';
import { pushMessage } from './client';

export const MAX_REMINDERS = 5;
export const REMIND_HOUR_JST = 9;

/** 'YYYY-MM-DD' の 09:00 JST を Date に */
export function remindAtFor(due: string | null | undefined, now: Date): Date {
  if (due) return new Date(`${due}T0${REMIND_HOUR_JST}:00:00+09:00`);
  // 期限なし: 3日後の 09:00 JST
  const key = jstDateKey(new Date(now.getTime() + 3 * 86_400_000));
  return new Date(`${key}T0${REMIND_HOUR_JST}:00:00+09:00`);
}

/** 監査ログ（失敗しても処理は止めない）。userId は画面操作のときだけ */
export async function lineAudit(action: string, detail: string, userId: string | null = null): Promise<void> {
  await prisma.auditLog
    .create({ data: { userId, action: `line.${action}`, detail: detail.slice(0, 500) } })
    .catch(() => undefined);
}

export function followUpDetail(f: { id: string; title: string; assigneeName?: string | null; due?: Date | null; groupId?: string | null }): string {
  const due = f.due ? jstDateKey(f.due) : '-';
  return `id=${f.id} group=${f.groupId ?? '-'} 担当=${f.assigneeName ?? '未定'} 期限=${due} 「${f.title}」`;
}

// ---------- 依頼 → FollowUp ----------

export interface CreateFollowUpArgs {
  groupId: string;
  sourceMessageId: string | null;
  extracted: Extracted;
  now: Date;
}

export async function createFollowUpFromExtracted(args: CreateFollowUpArgs) {
  const { groupId, sourceMessageId, extracted, now } = args;
  const f = await prisma.followUp.create({
    data: {
      groupId,
      sourceMessageId,
      title: extracted.title,
      assigneeName: extracted.assigneeName ?? null,
      due: extracted.due ? new Date(`${extracted.due}T00:00:00+09:00`) : null,
      status: 'open',
      remindAt: remindAtFor(extracted.due, now),
    },
  });
  await lineAudit('followup.create', `${followUpDetail(f)} 抽出=${extracted.kind}/${extracted.confidence}`);
  return f;
}

// ---------- 完了報告 → FollowUp 照合 ----------

export interface CompletionMatchArgs {
  groupId: string;
  text: string;
  senderName: string | null;
  quotedLineMessageId: string | null;
}

/** 完了報告に対応する未完了の FollowUp を1件選ぶ（引用 > 担当一致 > 本文の近さ） */
export async function findFollowUpForCompletion(args: CompletionMatchArgs) {
  const { groupId, text, senderName, quotedLineMessageId } = args;
  if (quotedLineMessageId) {
    const quoted = await prisma.lineMessage.findUnique({
      where: { lineMessageId: quotedLineMessageId },
      include: { followUps: { where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (quoted?.followUps[0]) return quoted.followUps[0];
  }
  const open = await prisma.followUp.findMany({
    where: { groupId, status: 'open' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  if (open.length === 0) return null;
  // 担当者本人の完了報告（表示名の前方一致）
  const mine = senderName
    ? open.filter((f) => f.assigneeName && (senderName.startsWith(f.assigneeName) || f.assigneeName.startsWith(senderName)))
    : [];
  const pool = mine.length > 0 ? mine : open;
  let best: (typeof open)[number] | null = null;
  let bestScore = 0;
  for (const f of pool) {
    const s = similarity(f.title, text);
    if (s > bestScore) {
      best = f;
      bestScore = s;
    }
  }
  if (best && bestScore >= 0.3) return best;
  // 本文が近くなくても、担当本人の未完了が1件だけならそれ
  if (mine.length === 1) return mine[0];
  return null;
}

export async function markFollowUpDone(id: string, by: string, userId: string | null = null) {
  const f = await prisma.followUp.update({ where: { id }, data: { status: 'done', remindAt: null } });
  await lineAudit('followup.done', `${followUpDetail(f)} by=${by}`, userId);
  return f;
}

// ---------- 受信メッセージの処理（webhook から） ----------

export interface IncomingText {
  groupId: string;
  lineMessageId: string;
  userId: string | null;
  displayName: string | null;
  text: string;
  ts: Date;
  quotedLineMessageId: string | null;
}

export interface ProcessResult {
  stored: boolean;
  duplicate: boolean;
  followUpId?: string;
  completedFollowUpId?: string;
  extracted?: Extracted | null;
}

/** 保存→抽出→FollowUp 作成／完了照合。再配信（同じ message id）は二重処理しない */
export async function processIncomingText(msg: IncomingText, now = new Date()): Promise<ProcessResult> {
  const existing = await prisma.lineMessage.findUnique({ where: { lineMessageId: msg.lineMessageId } });
  if (existing?.processedAt) return { stored: true, duplicate: true };

  const stored =
    existing ??
    (await prisma.lineMessage.create({
      data: {
        groupId: msg.groupId,
        lineMessageId: msg.lineMessageId,
        userId: msg.userId,
        displayName: msg.displayName,
        kind: 'text',
        text: msg.text,
        ts: msg.ts,
      },
    }));

  const result: ProcessResult = { stored: true, duplicate: false };
  const meta: Record<string, unknown> = {};

  if (isCompletion(msg.text)) {
    const target = await findFollowUpForCompletion({
      groupId: msg.groupId,
      text: msg.text,
      senderName: msg.displayName,
      quotedLineMessageId: msg.quotedLineMessageId,
    });
    if (target) {
      await markFollowUpDone(target.id, msg.displayName ?? msg.userId ?? 'line');
      result.completedFollowUpId = target.id;
      meta.completedFollowUpId = target.id;
    }
    meta.completion = true;
  }

  const ex = extract(msg.text, now);
  result.extracted = ex;
  if (ex) {
    meta.extracted = ex;
    if (ex.confidence === 'high' && !result.completedFollowUpId) {
      const f = await createFollowUpFromExtracted({ groupId: msg.groupId, sourceMessageId: stored.id, extracted: ex, now });
      result.followUpId = f.id;
      meta.followUpId = f.id;
    }
  }

  await prisma.lineMessage.update({
    where: { id: stored.id },
    data: { processedAt: now, extractedJson: Object.keys(meta).length ? JSON.stringify(meta) : null },
  });
  return result;
}

// ---------- 追いかけリマインド（cron から） ----------

export function reminderText(f: { title: string; assigneeName: string | null; due: Date | null; remindedCount: number }): string {
  const who = f.assigneeName ?? '未定';
  const due = f.due ? fmtDue(jstDateKey(f.due)) : 'なし';
  const nth = f.remindedCount + 1;
  const tail = nth >= MAX_REMINDERS ? `\n※ ${MAX_REMINDERS}回目のため自動追いかけはここまでです。管理画面で状況を確認します` : '';
  return `⏰ 追いかけ（${nth}回目）: ${f.title}（担当: ${who}・期限: ${due}）\n未完了なら状況を返信してください。完了していれば「完了しました」と返信してください${tail}`;
}

export async function runReminders(now = new Date()): Promise<{ sent: number; failed: number; capped: number }> {
  const due = await prisma.followUp.findMany({
    where: { status: 'open', remindAt: { lte: now }, groupId: { not: null } },
    orderBy: { remindAt: 'asc' },
    take: 50,
  });
  let sent = 0;
  let failed = 0;
  let capped = 0;
  for (const f of due) {
    if (!f.groupId) continue;
    const group = await prisma.lineGroup.findUnique({ where: { groupId: f.groupId } });
    if (!group?.active) {
      await prisma.followUp.update({ where: { id: f.id }, data: { remindAt: null } });
      continue;
    }
    try {
      await pushMessage(f.groupId, [reminderText(f)]);
    } catch (e) {
      failed++;
      console.warn(`[line] reminder push failed followUp=${f.id} ${e instanceof Error ? e.message : ''}`);
      // 次の cron でもう一度（1時間後）
      await prisma.followUp.update({ where: { id: f.id }, data: { remindAt: new Date(now.getTime() + 60 * 60_000) } });
      continue;
    }
    const count = f.remindedCount + 1;
    let next: Date | null = new Date((f.remindAt ?? now).getTime() + 86_400_000);
    while (next && next.getTime() <= now.getTime()) next = new Date(next.getTime() + 86_400_000);
    if (count >= MAX_REMINDERS) {
      next = null;
      capped++;
    }
    await prisma.followUp.update({
      where: { id: f.id },
      data: { remindedCount: count, lastRemindedAt: now, remindAt: next },
    });
    await lineAudit('followup.remind', `${followUpDetail(f)} 回数=${count}${next ? '' : ' 上限到達'}`);
    sent++;
  }
  return { sent, failed, capped };
}

// ---------- 定時投稿（cron から） ----------

function teamLabelsFor(teamCode: string | null): string[] {
  if (!teamCode) return [];
  return teamByCode(teamCode)?.kintoneLabels ?? [];
}

function fmtTask(t: TaskItem): string {
  return `・${t.title}（${t.assignee}${t.due ? `・${fmtDue(t.due)}` : ''}）`;
}

function fmtFollowUp(f: { title: string; assigneeName: string | null; due: Date | null }): string {
  const due = f.due ? `・${fmtDue(jstDateKey(f.due))}` : '';
  return `・${f.title}（${f.assigneeName ?? '未定'}${due}）`;
}

export interface PostContext {
  now: Date;
  tasks: TaskItem[] | null; // Kintone 取得失敗時は null
  tasksNotice: string | null;
}

export async function loadPostContext(now = new Date()): Promise<PostContext> {
  try {
    const r = await listTasks();
    return { now, tasks: r.tasks, tasksNotice: r.source === 'kintone' ? null : r.notice };
  } catch (e) {
    return { now, tasks: null, tasksNotice: e instanceof Error ? e.message : 'タスク取得に失敗' };
  }
}

export async function composePost(
  post: { template: string; body: string | null; groupId: string },
  group: { teamCode: string | null; name: string | null },
  ctx: PostContext,
): Promise<string | null> {
  const today = jstDateKey(ctx.now);
  const labels = teamLabelsFor(group.teamCode);
  const teamName = group.teamCode ? teamByCode(group.teamCode)?.name ?? group.teamCode : null;
  const teamTasks = (ctx.tasks ?? []).filter((t) => t.status !== '完了' && (labels.length === 0 ? false : labels.includes(t.team)));
  const dueToday = teamTasks.filter((t) => t.due === today);
  const overdue = teamTasks.filter((t) => t.due && t.due < today);

  if (post.template === 'custom') return post.body?.trim() ? post.body.trim() : null;

  const openFollowUps = await prisma.followUp.findMany({
    where: { groupId: post.groupId, status: 'open' },
    orderBy: [{ due: 'asc' }, { createdAt: 'asc' }],
    take: 20,
  });

  const lines: string[] = [];
  if (post.template === 'daily_summary') {
    lines.push(`📋 ${fmtDue(today)} のまとめ${teamName ? `（${teamName}）` : ''}`);
    lines.push('');
    lines.push(`■ 未完了の依頼・約束（${openFollowUps.length}件）`);
    lines.push(...(openFollowUps.length ? openFollowUps.map(fmtFollowUp) : ['・なし']));
    lines.push('');
    if (group.teamCode) {
      lines.push(`■ 本日期限のタスク（${dueToday.length}件）`);
      lines.push(...(dueToday.length ? dueToday.map(fmtTask) : ['・なし']));
      if (overdue.length) {
        lines.push('');
        lines.push(`■ 期限超過（${overdue.length}件）`);
        lines.push(...overdue.slice(0, 10).map(fmtTask));
      }
    } else {
      lines.push('■ タスク: このグループはチーム未設定のため表示していません（管理画面で設定）');
    }
    if (ctx.tasksNotice) lines.push(`※ ${ctx.tasksNotice}`);
    if (post.body?.trim()) lines.push('', post.body.trim());
    return lines.join('\n');
  }

  if (post.template === 'due_reminder') {
    const overdueFollowUps = openFollowUps.filter((f) => f.due && jstDateKey(f.due) < today);
    const todayFollowUps = openFollowUps.filter((f) => f.due && jstDateKey(f.due) === today);
    const total = overdue.length + dueToday.length + overdueFollowUps.length + todayFollowUps.length;
    if (total === 0) return null; // 何もなければ投稿しない（通知疲れ防止）
    lines.push(`⏰ 期限リマインド ${fmtDue(today)}${teamName ? `（${teamName}）` : ''}`);
    if (overdue.length || overdueFollowUps.length) {
      lines.push('', `🔴 期限超過（${overdue.length + overdueFollowUps.length}件）`);
      lines.push(...overdue.slice(0, 10).map(fmtTask), ...overdueFollowUps.map(fmtFollowUp));
    }
    if (dueToday.length || todayFollowUps.length) {
      lines.push('', `🟡 本日期限（${dueToday.length + todayFollowUps.length}件）`);
      lines.push(...dueToday.map(fmtTask), ...todayFollowUps.map(fmtFollowUp));
    }
    if (ctx.tasksNotice) lines.push(`※ ${ctx.tasksNotice}`);
    if (post.body?.trim()) lines.push('', post.body.trim());
    return lines.join('\n');
  }
  return null;
}

export const TEMPLATE_JA: Record<string, string> = {
  daily_summary: 'まとめ（未完了の依頼＋本日期限）',
  due_reminder: '期限リマインド（超過＋本日）',
  custom: '定型文',
};

export const TEAM_OPTIONS = TEAM_DEFS.map((t) => ({ code: t.code, name: t.name }));
