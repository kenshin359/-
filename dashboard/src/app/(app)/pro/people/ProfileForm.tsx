'use client';

// プロフィール編集（役職・Kintone担当者名・スキル・LINE userId）。
// 社員詳細の「編集」ボタンと PRO設定「自分のプロフィール」で共用する。保存は updateProfileAction（本人 or 管理者をサーバーで再検証）。
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Save } from 'lucide-react';
import { btn, inputCls, Field, Notice, SlideOver } from '@/components/ui';
import { updateProfileAction, type ActionResult } from './actions';

export interface ProfileFormValues {
  title: string;
  kintoneName: string;
  skills: string;
  lineUserId: string;
}

export function ProfileFields({
  values,
  onChange,
  disabled,
  members,
}: {
  values: ProfileFormValues;
  onChange: (v: ProfileFormValues) => void;
  disabled?: boolean;
  /** Kintone担当者の候補（datalist） */
  members?: string[];
}) {
  return (
    <div className="space-y-3">
      <Field label="役職・担当業務" hint="例: 広告責任者 / CS（楽天レビュー返信）">
        <input
          className={inputCls}
          value={values.title}
          onChange={(e) => onChange({ ...values, title: e.target.value })}
          maxLength={60}
          disabled={disabled}
        />
      </Field>
      <Field
        label="Kintone担当者名"
        hint="Kintoneタスク管理(38)の「担当者」と同じ表記（例: 北野）。これを合わせるとタスクの件数が本人に紐づきます"
      >
        <input
          className={inputCls}
          value={values.kintoneName}
          onChange={(e) => onChange({ ...values, kintoneName: e.target.value })}
          maxLength={30}
          list={members?.length ? 'kintone-member-options' : undefined}
          disabled={disabled}
        />
        {members?.length ? (
          <datalist id="kintone-member-options">
            {members.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        ) : null}
      </Field>
      <Field label="スキル" hint="カンマ区切り（例: 楽天RPP, Meta広告, Excel）">
        <input
          className={inputCls}
          value={values.skills}
          onChange={(e) => onChange({ ...values, skills: e.target.value })}
          maxLength={300}
          disabled={disabled}
        />
      </Field>
      <Field label="LINE userId" hint="LINE監査役ボットとの紐づけ用（U＋32桁）。未設定なら空欄のまま">
        <input
          className={`${inputCls} font-mono`}
          value={values.lineUserId}
          onChange={(e) => onChange({ ...values, lineUserId: e.target.value })}
          maxLength={64}
          placeholder="U0123456789abcdef0123456789abcdef"
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

/** 社員詳細の「編集」ボタン（サーバーコンポーネントから使う小さなクライアント部品） */
export function EditProfileButton(props: { userId: string; userName: string; initial: ProfileFormValues; members?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btn.secondary} onClick={() => setOpen(true)}>
        <Pencil size={14} aria-hidden />
        プロフィールを編集
      </button>
      <ProfileForm open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}

/** 右パネルで開く編集フォーム */
export default function ProfileForm({
  open,
  onClose,
  userId,
  userName,
  initial,
  members,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  initial: ProfileFormValues;
  members?: string[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProfileFormValues>(initial);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setValues(initial);
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    startTransition(async () => {
      const r = await updateProfileAction(userId, values);
      setResult(r);
      if (r.ok) {
        router.refresh();
        setTimeout(onClose, 600);
      }
    });
  };

  return (
    <SlideOver
      open={open}
      title={`${userName} のプロフィール`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={pending}>
            閉じる
          </button>
          <button type="button" className={btn.primary} onClick={submit} disabled={pending}>
            <Save size={14} aria-hidden />
            {pending ? '保存中…' : '保存'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {result && <Notice tone={result.ok ? 'ok' : 'error'}>{result.message}</Notice>}
        <ProfileFields values={values} onChange={setValues} disabled={pending} members={members} />
        <p className="text-[11px] leading-relaxed text-slate-500">
          権限レベル・所属部署は管理者が「PRO設定 → 権限・所属」で変更します。
        </p>
      </div>
    </SlideOver>
  );
}
