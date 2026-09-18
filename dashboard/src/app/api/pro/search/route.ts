// 横断検索（⌘K）。社員・タスク・資料・部署・画面を1つのクエリで返す。
// 権限: ログイン必須。一般社員は社員一覧を自チームに限定、機密画面は返さない。
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentActor, canSeeCompanyWide } from '@/lib/rbac';
import { listTasks } from '@/lib/tasks';
import { TEAM_DEFS } from '@/lib/pro/teams';

export const dynamic = 'force-dynamic';

export interface SearchHit {
  kind: 'task' | 'document' | 'user' | 'team' | 'page';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  badge?: string;
}

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

export async function GET(req: Request) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const q = norm((url.searchParams.get('q') ?? '').trim());
  if (q.length < 1) return NextResponse.json({ hits: [] as SearchHit[] });
  const limit = 8;
  const hits: SearchHit[] = [];

  // 部署
  for (const t of TEAM_DEFS) {
    if (norm(`${t.name} ${t.code} ${t.kintoneLabels.join(' ')} ${t.leader ?? ''}`).includes(q)) {
      hits.push({ kind: 'team', id: t.code, title: t.name, subtitle: t.leader ? `リーダー: ${t.leader}` : undefined, href: `/pro/teams/${t.code}` });
    }
  }

  // タスク（Kintone or ローカル）
  try {
    const { tasks } = await listTasks();
    let n = 0;
    for (const t of tasks) {
      if (n >= limit) break;
      if (norm(`${t.title} ${t.doneDef} ${t.assignee} ${t.team}`).includes(q)) {
        hits.push({
          kind: 'task',
          id: t.id,
          title: t.title,
          subtitle: `${t.assignee}・${t.team}${t.due ? `・期限 ${t.due}` : ''}`,
          href: `/tasks?q=${encodeURIComponent(t.title)}`,
          badge: t.status,
        });
        n++;
      }
    }
  } catch {
    // タスク取得失敗は検索全体を落とさない
  }

  // 資料
  const docs = await prisma.document.findMany({ orderBy: { updatedAt: 'desc' }, take: 200 });
  let dn = 0;
  for (const d of docs) {
    if (dn >= limit) break;
    if (norm(`${d.title} ${d.category} ${d.department ?? ''} ${d.note ?? ''}`).includes(q)) {
      hits.push({ kind: 'document', id: d.id, title: d.title, subtitle: `${d.category}${d.department ? `・${d.department}` : ''}`, href: d.url, badge: '資料' });
      dn++;
    }
  }

  // 社員（リーダー以上は全社、一般社員は自チームのみ）
  const users = await prisma.user.findMany({
    where: canSeeCompanyWide(actor.level) ? {} : { teamCode: actor.teamCode ?? '__none__' },
    select: { id: true, name: true, title: true, teamCode: true, kintoneName: true },
    take: 200,
  });
  let un = 0;
  for (const u of users) {
    if (un >= limit) break;
    if (norm(`${u.name} ${u.title ?? ''} ${u.kintoneName ?? ''} ${u.teamCode ?? ''}`).includes(q)) {
      const team = TEAM_DEFS.find((t) => t.code === u.teamCode);
      hits.push({ kind: 'user', id: u.id, title: u.name, subtitle: [team?.name, u.title].filter(Boolean).join('・') || undefined, href: `/pro/people/${u.id}` });
      un++;
    }
  }

  return NextResponse.json({ hits: hits.slice(0, 30) });
}
