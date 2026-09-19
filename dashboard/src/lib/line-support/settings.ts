import { prisma } from '@/lib/prisma';

/**
 * スタッフ用LINEグループのID。
 * 優先順: 環境変数 LINE_SUPPORT_STAFF_GROUP_ID > 公式アカウントをグループに招待したときに自動登録した値（Setting テーブル）。
 */
export const STAFF_GROUP_KEY = 'lineSupport.staffGroupId';

export async function getStaffGroupId(): Promise<string> {
  const env = (process.env.LINE_SUPPORT_STAFF_GROUP_ID || '').trim();
  if (env) return env;
  try {
    const row = await prisma.setting.findUnique({ where: { key: STAFF_GROUP_KEY } });
    return (row?.value ?? '').trim();
  } catch (e) {
    console.error('[line-ai] スタッフグループ設定の取得失敗:', e instanceof Error ? e.message : e);
    return '';
  }
}

export async function setStaffGroupId(groupId: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: STAFF_GROUP_KEY },
    create: { key: STAFF_GROUP_KEY, value: groupId },
    update: { value: groupId },
  });
}

export async function clearStaffGroupId(groupId: string): Promise<void> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: STAFF_GROUP_KEY } });
    if (row && row.value === groupId) await prisma.setting.delete({ where: { key: STAFF_GROUP_KEY } });
  } catch (e) {
    console.error('[line-ai] スタッフグループ設定の削除失敗:', e instanceof Error ? e.message : e);
  }
}
