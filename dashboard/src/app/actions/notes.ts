'use server';

// クイックメモ。どの画面からでも1行残せる（editor 以上）。
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireActor } from '@/lib/rbac';
import { canWrite } from '@/lib/auth';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const NoteInput = z.object({
  body: z.string().trim().min(1, 'メモを入力してください').max(2000),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(80).optional(),
});

export async function createNoteAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (!canWrite(actor.role)) return { ok: false, message: '閲覧者はメモを残せません' };
    const parsed = NoteInput.safeParse({
      body: form.get('body'),
      entityType: form.get('entityType') || undefined,
      entityId: form.get('entityId') || undefined,
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    await prisma.note.create({
      data: { body: parsed.data.body, entityType: parsed.data.entityType, entityId: parsed.data.entityId, authorUserId: actor.id, authorName: actor.name },
    });
    await prisma.auditLog.create({ data: { userId: actor.id, action: 'note.create', detail: parsed.data.body.slice(0, 120) } }).catch(() => undefined);
    return { ok: true, message: 'メモを保存しました' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}
