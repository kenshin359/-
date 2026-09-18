'use client';

// 部署ダッシュボードの「＋タスク」。右パネルに TaskForm（チームは部署の Kintone 表記を初期値に）。
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { btn, Notice, SlideOver } from '@/components/ui';
import type { TaskOptions } from '@/lib/tasks';
import TaskForm from '@/app/(app)/tasks/TaskForm';
import type { ActionResult } from '@/app/(app)/tasks/actions';

export default function TeamNewTask({ options, defaultTeam, defaultAssignee }: { options: TaskOptions; defaultTeam?: string; defaultAssignee?: string }) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn.primary}>
        <Plus size={14} aria-hidden /> タスク
      </button>
      {flash && (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto max-w-md">
          <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>
        </div>
      )}
      <SlideOver open={open} title="タスクを追加" onClose={() => setOpen(false)}>
        {open && (
          <TaskForm
            options={options}
            task={null}
            defaults={{ team: defaultTeam, assignee: defaultAssignee }}
            canEdit
            onDone={(r) => {
              setFlash(r);
              if (r.ok) {
                setOpen(false);
                router.refresh();
              }
            }}
          />
        )}
      </SlideOver>
    </>
  );
}
