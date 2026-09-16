'use server';

// ユーザー管理のサーバーアクション。画面の出し分けに頼らず、ここで必ず admin を検証する。
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createUser, deleteUser, resetPassword, UserInput } from '@/lib/users';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') throw new Error('管理者のみ操作できます');
  return session;
}

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail } });
}

export async function createUserAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireAdmin();
    const parsed = UserInput.safeParse({
      email: form.get('email'),
      name: form.get('name'),
      role: form.get('role'),
      password: form.get('password'),
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const u = await createUser(parsed.data);
    await audit(session.user.id, 'user.create', `${u.email} (${u.role})`);
    revalidatePath('/masters/users');
    return { ok: true, message: `${u.name} を登録しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '登録に失敗しました' };
  }
}

export async function resetPasswordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireAdmin();
    const userId = String(form.get('userId') ?? '');
    const password = String(form.get('password') ?? '');
    const u = await resetPassword(userId, password);
    await audit(session.user.id, 'user.reset_password', u.email);
    return { ok: true, message: `${u.name} のパスワードを変更しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '変更に失敗しました' };
  }
}

export async function deleteUserAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireAdmin();
    const userId = String(form.get('userId') ?? '');
    if (userId === session.user.id) return { ok: false, message: '自分自身は削除できません' };
    const u = await deleteUser(userId);
    await audit(session.user.id, 'user.delete', u.email);
    revalidatePath('/masters/users');
    return { ok: true, message: `${u.name} を削除しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '削除に失敗しました' };
  }
}
