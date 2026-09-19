'use client';

// PRO設定の画面。(a) 自分のプロフィール (b) 権限・所属の一覧編集（管理者のみ・行ごとに保存）
// (c) 閾値の表示（読み取り専用） (d) 連携状態へのリンク。
// 一般社員には (a) だけを見せる。管理者判定はサーバー（page.tsx / actions.ts）で行い、ここは表示のみ。
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Plug, Save, Shield, SlidersHorizontal, UserRound } from 'lucide-react';
import { btn, inputCls, Notice } from '@/components/ui';
import { assignLevelTeamAction, updateProfileAction, type ActionResult } from '../people/actions';
import { ProfileFields, type ProfileFormValues } from '../people/ProfileForm';

export interface UserRowData {
  id: string;
  name: string;
  email: string;
  roleJa: string;
  isAdminRole: boolean;
  level: string;
  teamCode: string; // '' = 未設定
  title: string;
  kintoneName: string;
  skills: string;
  lineUserId: string;
}

export interface ThresholdRow {
  name: string;
  rule: string;
  source: string;
}

interface Props {
  self: UserRowData & { levelJa: string; teamName: string };
  isAdmin: boolean;
  users: UserRowData[];
  levels: { code: string; name: string }[];
  teams: { code: string; name: string }[];
  members: string[];
  thresholds: ThresholdRow[];
}

function Section({ id, icon, title, lead, children }: { id: string; icon: React.ReactNode; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        {icon}
        {title}
      </h2>
      {lead && <p className="mt-1 text-xs leading-relaxed text-slate-500">{lead}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function useFlash() {
  const [flash, setFlash] = useState<ActionResult | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(id);
  }, [flash]);
  return [flash, setFlash] as const;
}

// ---- (a) 自分のプロフィール ----
function SelfProfile({ self, members }: { self: Props['self']; members: string[] }) {
  const router = useRouter();
  const initial: ProfileFormValues = { title: self.title, kintoneName: self.kintoneName, skills: self.skills, lineUserId: self.lineUserId };
  const [values, setValues] = useState<ProfileFormValues>(initial);
  const [flash, setFlash] = useFlash();
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  const save = () =>
    startTransition(async () => {
      const r = await updateProfileAction(self.id, values);
      setFlash(r);
      if (r.ok) router.refresh();
    });

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 self-start rounded-lg bg-slate-50 p-3 text-sm">
        <dt className="text-xs text-slate-500">氏名</dt>
        <dd className="text-slate-800">{self.name}</dd>
        <dt className="text-xs text-slate-500">メール</dt>
        <dd className="break-all text-xs text-slate-800">{self.email}</dd>
        <dt className="text-xs text-slate-500">権限</dt>
        <dd className="text-slate-800">
          {self.levelJa} <span className="text-xs text-slate-500">（ログインロール: {self.roleJa}）</span>
        </dd>
        <dt className="text-xs text-slate-500">所属</dt>
        <dd className="text-slate-800">{self.teamName}</dd>
        <dd className="col-span-2 text-[11px] leading-relaxed text-slate-500">氏名・メール・権限・所属の変更は管理者に依頼してください。</dd>
      </dl>
      <div className="space-y-3">
        {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.message}</Notice>}
        <ProfileFields values={values} onChange={setValues} disabled={pending} members={members} />
        <div className="flex justify-end">
          <button type="button" className={btn.primary} onClick={save} disabled={pending || !dirty}>
            <Save size={14} aria-hidden />
            {pending ? '保存中…' : 'プロフィールを保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- (b) 権限・所属の一覧編集（管理者のみ） ----
type RowState = { level: string; teamCode: string; kintoneName: string };

function AssignTable({ users, levels, teams, members }: { users: UserRowData[]; levels: Props['levels']; teams: Props['teams']; members: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(users.map((u) => [u.id, { level: u.level, teamCode: u.teamCode, kintoneName: u.kintoneName }])),
  );
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // サーバー再取得後（router.refresh）に props が変わったら、未編集の行をその値に合わせる
  useEffect(() => {
    setRows((prev) => {
      const next = { ...prev };
      for (const u of users) {
        const base = { level: u.level, teamCode: u.teamCode, kintoneName: u.kintoneName };
        if (!next[u.id]) next[u.id] = base;
      }
      return next;
    });
  }, [users]);

  const byId = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  const isDirty = (u: UserRowData) => {
    const r = rows[u.id];
    return !!r && (r.level !== u.level || r.teamCode !== u.teamCode || r.kintoneName !== u.kintoneName);
  };

  const setRow = (id: string, patch: Partial<RowState>) => setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const save = (id: string) => {
    const u = byId[id];
    const r = rows[id];
    if (!u || !r) return;
    setSavingId(id);
    startTransition(async () => {
      const messages: string[] = [];
      let ok = true;
      if (r.level !== u.level || r.teamCode !== u.teamCode) {
        const res = await assignLevelTeamAction(id, { level: r.level as never, teamCode: r.teamCode });
        ok = ok && res.ok;
        messages.push(res.message);
      }
      if (ok && r.kintoneName !== u.kintoneName) {
        const res = await updateProfileAction(id, { title: u.title, kintoneName: r.kintoneName, skills: u.skills, lineUserId: u.lineUserId });
        ok = ok && res.ok;
        messages.push(res.message);
      }
      setResults((prev) => ({ ...prev, [id]: { ok, message: messages.join(' / ') || '変更はありません' } as ActionResult }));
      setSavingId(null);
      if (ok) {
        // 保存後はサーバー値に合わせる（次の props 更新で isDirty が false になる）
        router.refresh();
      }
    });
  };

  return (
    <div className="overflow-x-auto">
      {members.length > 0 && (
        <datalist id="assign-member-options">
          {members.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-slate-500">
            <th className="py-2 pr-3">氏名</th>
            <th className="py-2 pr-3">ロール</th>
            <th className="py-2 pr-3">権限レベル</th>
            <th className="py-2 pr-3">所属部署</th>
            <th className="py-2 pr-3">Kintone担当者名</th>
            <th className="py-2">保存</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const r = rows[u.id] ?? { level: u.level, teamCode: u.teamCode, kintoneName: u.kintoneName };
            const dirty = isDirty(u);
            const res = results[u.id];
            const saving = savingId === u.id;
            return (
              <tr key={u.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">
                  <Link href={`/pro/people/${u.id}`} className="font-medium text-slate-800 hover:text-blue-800">
                    {u.name}
                  </Link>
                  <div className="text-[11px] text-slate-500">{u.email}</div>
                  {res && (
                    <div className={`mt-1 text-[11px] ${res.ok ? 'text-emerald-700' : 'text-red-700'}`} role={res.ok ? 'status' : 'alert'}>
                      {res.message}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{u.roleJa}</span>
                  {u.isAdminRole && <div className="mt-1 text-[10px] leading-tight text-slate-500">管理者は常に代表相当</div>}
                </td>
                <td className="py-2 pr-3">
                  <select
                    className={`${inputCls} min-w-[7rem]`}
                    value={r.level}
                    onChange={(e) => setRow(u.id, { level: e.target.value })}
                    disabled={saving}
                    aria-label={`${u.name} の権限レベル`}
                  >
                    {levels.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <select
                    className={`${inputCls} min-w-[9rem]`}
                    value={r.teamCode}
                    onChange={(e) => setRow(u.id, { teamCode: e.target.value })}
                    disabled={saving}
                    aria-label={`${u.name} の所属部署`}
                  >
                    <option value="">未設定</option>
                    {teams.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <input
                    className={`${inputCls} min-w-[7rem]`}
                    value={r.kintoneName}
                    onChange={(e) => setRow(u.id, { kintoneName: e.target.value })}
                    list={members.length ? 'assign-member-options' : undefined}
                    maxLength={30}
                    disabled={saving}
                    aria-label={`${u.name} のKintone担当者名`}
                    placeholder="例: 北野"
                  />
                </td>
                <td className="py-2">
                  <button type="button" className={btn.primary} onClick={() => save(u.id)} disabled={!dirty || saving}>
                    <Save size={14} aria-hidden />
                    {saving ? '保存中…' : '保存'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SettingsView({ self, isAdmin, users, levels, teams, members, thresholds }: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">PRO設定</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {isAdmin
            ? 'プロフィール・権限と所属・判定の閾値・外部連携の状態。権限と所属の変更はすべて監査ログに残ります。'
            : '自分のプロフィールを編集できます。権限・所属・閾値の管理は管理者のみです。'}
        </p>
      </div>

      <Section id="profile" icon={<UserRound size={14} className="text-slate-400" aria-hidden />} title="自分のプロフィール" lead="Kintone担当者名を合わせると、タスクの件数・期限超過が自分に紐づいて集計されます。">
        <SelfProfile self={self} members={members} />
      </Section>

      {isAdmin && (
        <>
          <Section
            id="assign"
            icon={<Shield size={14} className="text-slate-400" aria-hidden />}
            title="権限・所属（管理者）"
            lead="権限レベルは「何を見られるか」（機密は管理職以上、部署横断はリーダー以上）。ログインロール（管理者/編集者/閲覧者）は「書き込めるか」で、各種マスター管理 → ユーザー管理で変更します。"
          >
            <AssignTable users={users} levels={levels} teams={teams} members={members} />
            <p className="mt-2 text-[11px] text-slate-500">
              ユーザーの追加・パスワード変更・削除は{' '}
              <Link href="/masters/users" className="text-blue-800 underline-offset-2 hover:underline">
                ユーザー管理
              </Link>{' '}
              から。
            </p>
          </Section>

          <Section
            id="thresholds"
            icon={<SlidersHorizontal size={14} className="text-slate-400" aria-hidden />}
            title="判定の閾値（表示のみ）"
            lead="現場で使われている基準（docs/business.md §6）。現時点ではコード定数のため、この画面からは変更できません。変更が必要なときは開発側に依頼してください。"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">指標</th>
                    <th className="py-2 pr-3">基準</th>
                    <th className="py-2">定義場所</th>
                  </tr>
                </thead>
                <tbody>
                  {thresholds.map((t) => (
                    <tr key={t.name} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 font-medium text-slate-800">{t.name}</td>
                      <td className="py-2 pr-3 text-slate-700">{t.rule}</td>
                      <td className="py-2 font-mono text-[11px] text-slate-500">{t.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">出典: dashboard/docs/business.md §6「KPIと判定基準」・docs/metrics.md</p>
          </Section>

          <Section
            id="integrations"
            icon={<Plug size={14} className="text-slate-400" aria-hidden />}
            title="連携状態"
            lead="Kintone・楽天・Amazon・Meta・Google・LINE などの接続状態は「データ連携設定」で確認します。未接続のものは成功と偽らず「未接続」と表示されます。"
          >
            <Link href="/integrations" className={btn.secondary}>
              <ExternalLink size={14} aria-hidden />
              データ連携設定を開く
            </Link>
          </Section>
        </>
      )}
    </div>
  );
}
