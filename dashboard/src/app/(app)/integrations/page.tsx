// データ連携設定。未接続のものは正直に「未接続」を表示する（成功と偽らない）。
import { kintoneTaskAppId, kintoneTaskConfigured } from '@/lib/kintone';

export const dynamic = 'force-dynamic';

const CONNECTORS = [
  { name: '統一CSV取込', status: 'built_next', note: '取込UIは次工程（データ仕様は docs/data-contracts.md 確定済み）' },
  { name: '楽天API（RMS）', status: 'disconnected', note: '認証情報の提供後に接続作業' },
  { name: 'Amazon SP-API', status: 'disconnected', note: '認証情報の提供後に接続作業' },
  { name: 'Meta広告API', status: 'disconnected', note: '認証情報の提供後に接続作業' },
  { name: 'Google広告API', status: 'disconnected', note: '認証情報の提供後に接続作業' },
  { name: 'LLM提案（AIに質問）', status: 'disconnected', note: '初期版はルールベース提案のみ。LLM接続は追加開発範囲' },
];

const BADGE: Record<string, { label: string; cls: string }> = {
  connected: { label: '接続中', cls: 'bg-emerald-100 text-emerald-800' },
  disconnected: { label: '未接続', cls: 'bg-slate-100 text-slate-600' },
  built_next: { label: '次工程', cls: 'bg-amber-100 text-amber-700' },
};

export default function IntegrationsPage() {
  const kintoneOk = kintoneTaskConfigured();
  const connectors = [
    {
      name: `Kintone タスク管理（アプリ ${kintoneTaskAppId()}）`,
      status: kintoneOk ? 'connected' : 'disconnected',
      note: kintoneOk
        ? 'タスク管理画面はKintoneのレコードを直接読み書きします（Kintoneが正）'
        : '環境変数 KINTONE_BASE_URL と KINTONE_API_TOKEN_TASK（閲覧・追加・編集権限）を設定すると接続。未接続の間はダッシュボード内DBに保存',
    },
    ...CONNECTORS,
  ];
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold text-slate-800">データ連携設定</h1>
      <p className="mt-1 text-sm text-slate-500">
        本番APIの自動連携は追加開発範囲です。接続済みでないものは「未接続」と表示します。
      </p>
      <div className="mt-4 divide-y divide-slate-100">
        {connectors.map((c) => (
          <div key={c.name} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-slate-700">{c.name}</p>
              <p className="text-xs text-slate-400">{c.note}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[c.status].cls}`}>
              {BADGE[c.status].label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
