'use server';

// 資料庫のサーバーアクション。editor 以上のみ登録・編集・削除できる（サーバー側で検証）。
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions, canWrite } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createDocument, deleteDocument, DocumentInput, updateDocument } from '@/lib/documents';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function requireEditor() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error('ログインが必要です');
  if (!canWrite(session.user.role)) throw new Error('閲覧者は資料を編集できません');
  return session;
}

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

function pick(form: FormData) {
  return {
    title: form.get('title'),
    category: form.get('category'),
    department: form.get('department') ?? '',
    url: form.get('url'),
    note: form.get('note') ?? '',
  };
}

export async function createDocumentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireEditor();
    const parsed = DocumentInput.safeParse(pick(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = await createDocument(parsed.data, { id: session.user.id, name: session.user.name ?? '' });
    await audit(session.user.id, 'document.create', `${d.id} ${d.title}`);
    revalidatePath('/documents');
    return { ok: true, message: `「${d.title}」を登録しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '登録に失敗しました' };
  }
}

export async function updateDocumentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireEditor();
    const id = String(form.get('id') ?? '');
    if (!id) return { ok: false, message: '資料IDがありません' };
    const parsed = DocumentInput.safeParse(pick(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = await updateDocument(id, parsed.data);
    await audit(session.user.id, 'document.update', `${d.id} ${d.title}`);
    revalidatePath('/documents');
    return { ok: true, message: '保存しました' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

export async function deleteDocumentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireEditor();
    const id = String(form.get('id') ?? '');
    if (!id) return { ok: false, message: '資料IDがありません' };
    const d = await deleteDocument(id);
    await audit(session.user.id, 'document.delete', `${d.id} ${d.title}`);
    revalidatePath('/documents');
    return { ok: true, message: `「${d.title}」を削除しました（Googleドライブ上の実体は消えません）` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '削除に失敗しました' };
  }
}
