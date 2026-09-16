import Link from 'next/link';

const ITEMS = [
  { href: '/masters/users', label: 'ユーザー管理', note: '利用者の追加・ロール変更・パスワード変更（管理者のみ）', ready: true },
  { href: '#', label: '商品・SKUマスター', note: '次工程（CSV取込と同時に実装）', ready: false },
  { href: '#', label: 'チャネル・媒体・倉庫・仕入先', note: '次工程', ready: false },
  { href: '#', label: '原価マスター（有効期間付き）', note: '次工程', ready: false },
  { href: '#', label: '提案ルールの閾値設定', note: '次工程', ready: false },
];

export default function MastersPage() {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold text-slate-800">各種マスター管理</h1>
      <div className="mt-4 divide-y divide-slate-100">
        {ITEMS.map((i) => (
          <div key={i.label} className="flex items-center justify-between py-3">
            <div>
              {i.ready ? (
                <Link href={i.href} className="text-sm font-medium text-blue-800 hover:underline">
                  {i.label} →
                </Link>
              ) : (
                <p className="text-sm font-medium text-slate-500">{i.label}</p>
              )}
              <p className="text-xs text-slate-400">{i.note}</p>
            </div>
            {!i.ready && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">次工程</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
