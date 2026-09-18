'use server';

// 資料庫2.0 のサーバーアクション。editor 以上のみ登録・編集・削除・一括タグができる（サーバー側で検証）。
// 機密種別（人事資料・契約書）の登録・変更・削除は管理職以上に限る（見えない資料を触らせない）。
import { revalidatePath } from 'next/cache';
import { canWrite } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canSeeConfidential, requireActor, type Actor } from '@/lib/rbac';
import { getLibraryDoc, isConfidentialDocType, LibraryDocInput, normalizeTag, parseTags, serializeTags, visibilityWhere } from '@/lib/pro/library';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function requireEditor(): Promise<Actor> {
  const actor = await requireActor();
  if (!canWrite(actor.role)) throw new Error('閲覧者は資料を編集できません');
  return actor;
}

function requireConfidentialIf(actor: Actor, docType: string | null | undefined) {
  if (isConfidentialDocType(docType) && !canSeeConfidential(actor.level)) {
    throw new Error('人事資料・契約書は管理職以上のみ登録・変更できます');
  }
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
    docType: form.get('docType') ?? '',
    tags: form.getAll('tags').map(String).join(','),
  };
}

function revalidate() {
  revalidatePath('/pro/library');
  revalidatePath('/documents');
}

export async function createLibraryDocAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const parsed = LibraryDocInput.safeParse(pick(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const input = parsed.data;
    requireConfidentialIf(actor, input.docType);
    const d = await prisma.document.create({
      data: {
        title: input.title,
        category: input.category,
        department: input.department || null,
        url: input.url,
        note: input.note || null,
        docType: input.docType,
        tags: serializeTags(input.tags),
        ownerId: actor.id,
        ownerName: actor.name,
      },
    });
    await audit(actor.id, 'library.create', `${d.id} ${d.title} [${d.docType}] tags=${d.tags ?? ''}`);
    revalidate();
    return { ok: true, message: `「${d.title}」を登録しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '登録に失敗しました' };
  }
}

export async function updateLibraryDocAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const id = String(form.get('id') ?? '');
    if (!id) return { ok: false, message: '資料IDがありません' };
    const parsed = LibraryDocInput.safeParse(pick(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const input = parsed.data;
    const current = await getLibraryDoc(id, actor);
    if (!current) return { ok: false, message: '資料が見つからないか、編集する権限がありません' };
    requireConfidentialIf(actor, current.docType);
    requireConfidentialIf(actor, input.docType);
    const d = await prisma.document.update({
      where: { id },
      data: {
        title: input.title,
        category: input.category,
        department: input.department || null,
        url: input.url,
        note: input.note || null,
        docType: input.docType,
        tags: serializeTags(input.tags),
      },
    });
    await audit(actor.id, 'library.update', `${d.id} ${d.title} [${d.docType}] tags=${d.tags ?? ''}`);
    revalidate();
    return { ok: true, message: '保存しました' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

export async function deleteLibraryDocAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const id = String(form.get('id') ?? '');
    if (!id) return { ok: false, message: '資料IDがありません' };
    const current = await getLibraryDoc(id, actor);
    if (!current) return { ok: false, message: '資料が見つからないか、削除する権限がありません' };
    requireConfidentialIf(actor, current.docType);
    const d = await prisma.document.delete({ where: { id } });
    await audit(actor.id, 'library.delete', `${d.id} ${d.title}`);
    revalidate();
    return { ok: true, message: `「${d.title}」を削除しました（Googleドライブ上の実体は消えません）` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '削除に失敗しました' };
  }
}

/** 選択した資料にタグを一括で追加／削除する。form: ids（複数）, tag, mode=add|remove */
export async function bulkTagAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEditor();
    const ids = [...new Set(form.getAll('ids').map(String).filter(Boolean))].slice(0, 200);
    const tag = normalizeTag(String(form.get('tag') ?? ''));
    const mode = String(form.get('mode') ?? 'add');
    if (ids.length === 0) return { ok: false, message: '資料を選択してください' };
    if (!tag) return { ok: false, message: 'タグを入力してください' };
    if (mode !== 'add' && mode !== 'remove') return { ok: false, message: '操作が不正です' };
    // 権限内で見える資料だけを対象にする（機密種別は管理職以上のみ）
    const rows = await prisma.document.findMany({ where: { id: { in: ids }, ...visibilityWhere(actor.level) }, select: { id: true, tags: true } });
    if (rows.length === 0) return { ok: false, message: '対象の資料が見つかりません' };
    let changed = 0;
    await prisma.$transaction(
      rows
        .map((r) => {
          const cur = parseTags(r.tags);
          const has = cur.some((t) => t.toLowerCase() === tag.toLowerCase());
          const next = mode === 'add' ? (has ? cur : [...cur, tag]) : cur.filter((t) => t.toLowerCase() !== tag.toLowerCase());
          if (next.length === cur.length) return null;
          changed++;
          return prisma.document.update({ where: { id: r.id }, data: { tags: serializeTags(next) } });
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    );
    await audit(actor.id, `library.tag.${mode}`, `tag=${tag} ids=${rows.map((r) => r.id).join(',')} changed=${changed}`);
    revalidate();
    const verb = mode === 'add' ? '追加' : '削除';
    return { ok: true, message: changed === 0 ? `タグ「${tag}」は変更ありませんでした` : `${changed}件にタグ「${tag}」を${verb}しました` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'タグの更新に失敗しました' };
  }
}
