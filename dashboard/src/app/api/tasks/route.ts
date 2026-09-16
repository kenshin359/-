// タスクAPI。書込はサーバー側でロール検証（viewerは403）— 画面制御だけに頼らない。
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions, canWrite } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const tasks = await prisma.task.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return NextResponse.json({ tasks });
}

const CreateTask = z.object({
  title: z.string().min(1).max(200),
  priority: z.enum(['high', 'mid', 'low']).default('mid'),
  dueDate: z.string().date().optional(),
  relation: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: 'forbidden: viewerは書込できません' }, { status: 403 });
  }
  const body = CreateTask.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }
  const task = await prisma.task.create({
    data: {
      title: body.data.title,
      priority: body.data.priority,
      relation: body.data.relation,
      dueDate: body.data.dueDate ? new Date(`${body.data.dueDate}T00:00:00+09:00`) : undefined,
    },
  });
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: 'task.create', detail: task.id },
  });
  return NextResponse.json({ task }, { status: 201 });
}
