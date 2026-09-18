// PRO: 実装中のプレースホルダ（各画面は個別に実装して置き換える）
import { requireActor } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireActor();
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold text-slate-900">reports</h1>
      <p className="mt-2 text-sm text-slate-500">この画面は実装中です（PRO版 設計書 docs/pro-plan.md）。</p>
    </div>
  );
}
