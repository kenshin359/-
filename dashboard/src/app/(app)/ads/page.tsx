import Link from 'next/link';

export default function Page() {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold text-slate-800">広告分析</h1>
      <p className="mt-2 text-sm text-slate-500">
        媒体別の広告分析（ROAS・CPC・CPM等）は次工程で実装します（docs/progress.md の状態管理表を参照）。
        集計はダッシュボードと同じ指標辞書（docs/metrics.md）を使用します。
      </p>
      <Link
        href="/ads/cpa"
        className="mt-4 inline-block rounded-md bg-blue-900 px-4 py-2 text-sm text-white hover:bg-blue-800"
      >
        合算CPA（スーツケース）を開く →
      </Link>
      <p className="mt-2 text-xs text-slate-500">
        日別×媒体の広告費と日別×チャネルの販売個数から合算CPA・広告比率を判定（合格／注意／超過）。Excelからの貼り付け取込に対応。
      </p>
    </div>
  );
}
