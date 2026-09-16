// ユーザー登録・更新の共通処理（管理画面とCLIの両方から使う）
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from './prisma';

export const ROLES = ['admin', 'editor', 'viewer'] as const;
export const ROLE_JA: Record<string, string> = {
  admin: '管理者',
  editor: '編集者',
  viewer: '閲覧者',
};

export const UserInput = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません').transform((s) => s.trim().toLowerCase()),
  name: z.string().min(1, '氏名は必須です').max(50),
  role: z.enum(ROLES),
  password: z.string().min(10, 'パスワードは10文字以上にしてください').max(100),
});

export async function createUser(input: z.infer<typeof UserInput>) {
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw new Error('このメールアドレスは登録済みです');
  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: await bcrypt.hash(input.password, 10),
    },
  });
}

export async function resetPassword(userId: string, password: string) {
  if (password.length < 10) throw new Error('パスワードは10文字以上にしてください');
  return prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });
}

/** 最後の管理者は削除させない（誰も入れなくなるのを防ぐ） */
export async function deleteUser(userId: string) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error('ユーザーが見つかりません');
  if (target.role === 'admin') {
    const admins = await prisma.user.count({ where: { role: 'admin' } });
    if (admins <= 1) throw new Error('最後の管理者は削除できません');
  }
  await prisma.task.updateMany({ where: { assigneeId: userId }, data: { assigneeId: null } });
  await prisma.auditLog.updateMany({ where: { userId }, data: { userId: null } });
  return prisma.user.delete({ where: { id: userId } });
}
