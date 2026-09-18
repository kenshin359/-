'use server';

// LINE対応画面のサーバーアクション。画面の出し分けに頼らず、ここでロールを検証する（viewerは不可）。
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions, canWrite } from '@/lib/auth';
import { closeCase } from '@/lib/line/cases';
import { prisma } from '@/lib/prisma';

export async function closeCaseAction(form: FormData): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session || !canWrite(session.user.role)) throw new Error('編集者以上のみ操作できます');
  const no = Number(form.get('no'));
  if (!Number.isInteger(no) || no <= 0) throw new Error('案件番号が不正です');
  const c = await closeCase(no);
  if (c) {
    await prisma.auditLog.create({ data: { userId: session.user.id, action: 'line.case.close', detail: `#${no}` } });
  }
  revalidatePath('/line');
}
