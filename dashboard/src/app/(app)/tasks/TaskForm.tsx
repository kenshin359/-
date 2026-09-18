'use client';

// タスクの登録・編集フォーム（カンバン・クイックアクションで共用）。柳井ルールを必須項目で強制する。
import { useActionState, useEffect } from 'react';
import { btn, Field, inputCls, Notice } from '@/components/ui';
import type { TaskItem, TaskOptions } from '@/lib/tasks';
import { IMPACTS, PRIORITIES, STATUSES } from '@/lib/tasks-constants';
import { createTaskAction, updateTaskAction, type ActionResult } from './actions';

export default function TaskForm({
  options,
  task,
  defaults,
  canEdit,
  onDone,
}: {
  options: TaskOptions;
  task: TaskItem | null;
  defaults?: { assignee?: string; team?: string };
  canEdit: boolean;
  onDone: (r: ActionResult) => void;
}) {
  const action = task ? updateTaskAction : createTaskAction;
  const [result, formAction, pending] = useActionState(action, null);
  useEffect(() => {
    if (result) onDone(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const ro = !canEdit;
  return (
    <form action={formAction} className="space-y-3">
      {task && <input type="hidden" name="id" value={task.id} />}
      <Field label="タスク名" required>
        <input name="title" required maxLength={120} defaultValue={task?.title ?? ''} readOnly={ro} className={inputCls} placeholder="例: Amazonタイムセール祭り申請・SKU/価格確定" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="担当者" required>
          <select name="assignee" required defaultValue={task?.assignee ?? defaults?.assignee ?? ''} disabled={ro} className={inputCls}>
            <option value="">選択</option>
            {options.members.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="チーム" required>
          <select name="team" required defaultValue={task?.team ?? defaults?.team ?? ''} disabled={ro} className={inputCls}>
            <option value="">選択</option>
            {options.teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="完了の定義" required hint="数字で。「報告した」は完了ではありません（例: 申請完了＋対象SKU・セール価格リスト共有）">
        <input name="doneDef" required maxLength={200} defaultValue={task?.doneDef ?? ''} readOnly={ro} className={inputCls} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="期限" required>
          <input name="due" type="date" required defaultValue={task?.due ?? ''} readOnly={ro} className={`${inputCls} tabular`} />
        </Field>
        <Field label="優先度" hint="P1が終わるまでP2に着手しない">
          <select name="priority" defaultValue={task?.priority ?? 'P2'} disabled={ro} className={inputCls}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="状態">
          <select name="status" defaultValue={task?.status ?? '未着手'} disabled={ro} className={inputCls}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="売上直結度">
        <select name="impact" defaultValue={task?.impact || '○ 間接（計測・基盤）'} disabled={ro} className={inputCls}>
          {IMPACTS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </Field>
      <Field label="柳井基準（撤退・判断ライン）" hint="先に決める。例: 2週間でCPA改善なければ訴求ごと撤退">
        <input name="yanai" maxLength={200} defaultValue={task?.yanai ?? ''} readOnly={ro} className={inputCls} />
      </Field>
      <Field label="備考" hint="日々の一言は朝礼で。ここは補足だけ">
        <textarea name="memo" rows={3} maxLength={2000} defaultValue={task?.memo ?? ''} readOnly={ro} className={inputCls} />
      </Field>
      {task?.updatedAt && (
        <p className="text-[11px] text-slate-500">
          最終更新 {new Date(task.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
          {task.source === 'kintone' ? `・Kintone レコード #${task.id}` : '・ローカル保存'}
        </p>
      )}
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
      {canEdit ? (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="submit" disabled={pending} className={btn.primary}>
            {pending ? '保存中…' : task ? '保存' : '登録'}
          </button>
        </div>
      ) : (
        <Notice tone="info">閲覧者のため編集できません。変更が必要なときは編集者へ依頼してください。</Notice>
      )}
    </form>
  );
}
