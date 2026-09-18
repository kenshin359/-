'use client';

// 資料の登録・編集フォーム（資料庫・クイックアクションで共用）
import { useActionState, useEffect } from 'react';
import { btn, Field, inputCls, Notice } from '@/components/ui';
import { DOC_CATEGORIES, DOC_DEPARTMENTS, type DocumentItem } from '@/lib/documents';
import { createDocumentAction, updateDocumentAction, type ActionResult } from './actions';

export default function DocForm({ doc, onDone }: { doc: DocumentItem | null; onDone: (r: ActionResult) => void }) {
  const [result, formAction, pending] = useActionState(doc ? updateDocumentAction : createDocumentAction, null);
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  return (
    <form action={formAction} className="space-y-3">
      {doc && <input type="hidden" name="id" value={doc.id} />}
      <Field label="資料名" required>
        <input name="title" required maxLength={120} defaultValue={doc?.title ?? ''} className={inputCls} placeholder="例: 営業研修資料" />
      </Field>
      <Field label="GoogleドライブのURL" required hint="ドライブで「リンクを取得」→ 社内の閲覧権限を付けたURLを貼る（https://）">
        <input name="url" type="url" required defaultValue={doc?.url ?? ''} className={inputCls} placeholder="https://drive.google.com/drive/folders/…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="カテゴリ" required>
          <select name="category" required defaultValue={doc?.category ?? ''} className={inputCls}>
            <option value="">選択</option>
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="部署・チーム">
          <select name="department" defaultValue={doc?.department ?? ''} className={inputCls}>
            <option value="">指定なし</option>
            {DOC_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="メモ" hint="何の資料か、誰向けかを一言">
        <textarea name="note" rows={3} maxLength={500} defaultValue={doc?.note ?? ''} className={inputCls} />
      </Field>
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? '保存中…' : doc ? '保存' : '登録'}
        </button>
      </div>
    </form>
  );
}

