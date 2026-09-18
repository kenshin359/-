import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions, canWrite } from '@/lib/auth';
import { computeBoardStats, listTasks } from '@/lib/tasks';
import TaskBoard, { type BoardFilter } from './TaskBoard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'タスク管理' };

const FILTERS: BoardFilter[] = ['all', 'today', 'overdue', 'p1', 'open'];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const [session, data, params] = await Promise.all([getServerSession(authOptions), listTasks(), searchParams]);
  const stats = computeBoardStats(data.tasks);
  const f = params.filter as BoardFilter | undefined;
  const initialFilter: BoardFilter = f && FILTERS.includes(f) ? (f === 'open' ? 'all' : f) : 'all';

  return (
    <TaskBoard
      tasks={data.tasks}
      options={data.options}
      stats={stats}
      source={data.source}
      notice={data.notice}
      appId={data.appId}
      canEdit={canWrite(session?.user.role)}
      currentUserName={session?.user.name ?? ''}
      initialFilter={initialFilter}
      initialQuery={params.q ?? ''}
    />
  );
}
