import { getDashboardData } from '@/lib/data';
import { formatMetric, formatYen } from '@/lib/metrics/format';
import type { MetricValue } from '@/lib/metrics/types';
import {
  ChannelBarChart,
  DailyLineChart,
  Sparkline,
  WaterfallChart,
} from '@/components/charts';

export const dynamic = 'force-dynamic';

function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl bg-white p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-2 text-[13px] font-semibold text-slate-700">{title}</h2>}
      {children}
    </section>
  );
}

function Change({ m }: { m: MetricValue }) {
  if (m.kind === 'na') return <span className="text-xs text-slate-400">{m.reason}</span>;
  const up = m.value >= 0;
  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? '▲' : '▼'} {Math.abs(m.value).toFixed(1)}%
    </span>
  );
}

export default async function DashboardPage() {
  const d = await getDashboardData();
  const m = d.current;

  const kpis = [
    {
      label: '売上（純売上）',
      value: formatYen(m.netSales),
      sub: <Change m={d.salesChange} />,
    },
    {
      label: '貢献利益',
      value: `${formatYen(m.contributionProfit)}${m.cogsMissingLines > 0 ? '（暫定）' : ''}`,
      sub: (
        <span className="text-xs text-slate-500">
          率 {formatMetric(m.contributionMargin, '%')}
        </span>
      ),
    },
    {
      label: '広告費',
      value: formatYen(m.adSpend),
      sub: (
        <span className="text-xs text-slate-500">
          広告費率 {formatMetric(m.adRatio, '%')}
        </span>
      ),
    },
    {
      label: 'ROAS（媒体報告）',
      value: formatMetric(m.roas, '倍'),
      sub: <span className="text-xs text-slate-500">MER {formatMetric(m.mer, '倍')}</span>,
    },
    {
      label: '注文数',
      value: `${m.orderCount.toLocaleString('ja-JP')}件`,
      sub: (
        <span className="text-xs text-slate-500">
          客単価 {formatMetric(m.aov, '円', 0)}
        </span>
      ),
    },
  ];

  const waterfall = [
    { name: '純売上', value: m.netSales },
    { name: '原価', value: -m.cogs },
    { name: '広告費', value: -m.adSpend },
    { name: '手数料', value: -m.commission },
    { name: '配送費', value: -m.shippingCost },
    { name: '貢献利益', value: m.contributionProfit },
  ];

  const priorityBadge: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    mid: 'bg-amber-100 text-amber-700',
    low: 'bg-slate-100 text-slate-600',
  };

  return (
    <div className="space-y-4">
      {/* 期間バー */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          集計期間: <b className="text-slate-700">{d.periodLabel}</b>
        </span>
        <span>比較期間: {d.compareLabel}</span>
        <span>
          最終取込:{' '}
          {d.lastImportAt ? new Date(d.lastImportAt).toLocaleString('ja-JP') : 'CSV取込なし（シードデータ）'}
        </span>
        {d.demoMode && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
            デモデータ表示中（実データ取込後に自動で切替）
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          {/* KPI 5枚 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {kpis.map((k) => (
              <Card key={k.label}>
                <p className="text-[11px] text-slate-500">{k.label}</p>
                <p className="mt-1 truncate text-lg font-bold text-slate-900">{k.value}</p>
                <div className="mt-1">{k.sub}</div>
              </Card>
            ))}
          </div>

          {/* 中段 */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title="モール別売上（期間内）">
              <ChannelBarChart data={d.channelSales} />
            </Card>
            <Card title="日別売上推移（今期 vs 前期）">
              <DailyLineChart data={d.dailySeries} />
            </Card>
            <Card title="月間目標 vs 着地予測">
              <div className="space-y-2 text-sm">
                <Row label="月間目標" value={d.monthTarget !== null ? formatYen(d.monthTarget) : '未設定'} />
                <Row label="当月実績" value={formatYen(d.monthToDate)} />
                <Row
                  label="着地予測"
                  value={
                    d.forecast.kind === 'value'
                      ? `${formatYen(d.forecast.value)}`
                      : d.forecast.reason
                  }
                />
                <p className="text-[11px] text-slate-400">
                  予測=確定{d.forecastDays}日の日次平均×当月日数（単純ペース予測）
                </p>
                {d.monthTarget !== null && d.forecast.kind === 'value' && (
                  <div className="mt-1">
                    <div className="h-2 w-full rounded bg-slate-100">
                      <div
                        className={`h-2 rounded ${
                          d.forecast.value >= d.monthTarget ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                        style={{
                          width: `${Math.min(100, (d.forecast.value / d.monthTarget) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      予測到達率 {((d.forecast.value / d.monthTarget) * 100).toFixed(1)}%
                    </p>
                  </div>
                )}
                <Row
                  label="広告予算消化"
                  value={
                    d.adBudget !== null
                      ? `${formatYen(d.monthAdSpend)} / ${formatYen(d.adBudget)}`
                      : `${formatYen(d.monthAdSpend)}（予算未設定）`
                  }
                />
              </div>
            </Card>
          </div>

          {/* スパークライン + ウォーターフォール */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card title="直近14日のトレンド">
              <div className="grid grid-cols-2 gap-3">
                <SparkBlock label="セッション" data={d.sparkline.sessions} color="#0ea5e9" />
                <SparkBlock label="CVR(%)" data={d.sparkline.cvr} color="#8b5cf6" />
                <SparkBlock label="客単価(円)" data={d.sparkline.aov} color="#f59e0b" />
                <SparkBlock label="注文数" data={d.sparkline.orders} color="#1d4ed8" />
              </div>
            </Card>
            <Card title="利益構造（期間内・変動費まで）">
              <WaterfallChart steps={waterfall} />
              <p className="mt-1 text-[11px] text-slate-400">
                固定費は含まないため営業利益ではなく貢献利益として表示
              </p>
            </Card>
          </div>

          {/* 下段 */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title="商品別売上 TOP10（期間内）">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      <th className="py-1 pr-2">商品</th>
                      <th className="py-1 pr-2 text-right">個数</th>
                      <th className="py-1 text-right">売上</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topSkus.map((s) => (
                      <tr key={s.name} className="border-b border-slate-100">
                        <td className="max-w-[160px] truncate py-1 pr-2">{s.name}</td>
                        <td className="py-1 pr-2 text-right">{s.qty}</td>
                        <td className="py-1 text-right">{formatYen(s.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="仕入れパイプライン（代表4段・全段は詳細）">
              <div className="space-y-2">
                {d.pipeline.length === 0 && (
                  <p className="text-xs text-slate-400">進行中の案件はありません</p>
                )}
                {d.pipeline.map((p) => (
                  <div key={p.status} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{p.status}</span>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {p.count}件
                    </span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="未完了タスク">
              <div className="space-y-2">
                {d.tasks.length === 0 && <p className="text-xs text-slate-400">未完了タスクなし</p>}
                {d.tasks.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 ${priorityBadge[t.priority]}`}>
                      {t.priority === 'high' ? '高' : t.priority === 'mid' ? '中' : '低'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-slate-700">{t.title}</p>
                      <p className="text-[10px] text-slate-400">
                        {t.status} {t.dueDate ? `期限 ${t.dueDate}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* 右カラム */}
        <div className="w-full shrink-0 space-y-4 xl:w-[320px]">
          <Card title="AI改善提案（ルールベース）">
            <div className="space-y-3">
              {d.proposals.length === 0 && (
                <p className="text-xs text-slate-400">現在オープンの提案はありません</p>
              )}
              {d.proposals.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-800">
                    P{p.priority} {p.title}
                  </p>
                  <dl className="mt-1 space-y-0.5">
                    {Object.entries(p.facts).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-[11px] text-slate-500">
                        <dt>{k}</dt>
                        <dd className="font-medium text-slate-700">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {p.action && <p className="mt-1 text-[11px] text-slate-600">対応: {p.action}</p>}
                  {p.effectNote && (
                    <p className="mt-1 text-[11px] text-amber-700">{p.effectNote}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <Card title="アラート">
            <div className="space-y-2">
              {d.alerts.length === 0 && <p className="text-xs text-slate-400">アラートなし</p>}
              {d.alerts.map((a) => (
                <p key={a} className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                  ⚠ {a}
                </p>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function SparkBlock({
  label,
  data,
  color,
}: {
  label: string;
  data: { date: string; v: number }[];
  color: string;
}) {
  const last = data.length > 0 ? data[data.length - 1].v : null;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] text-slate-500">{label}</p>
        <p className="text-xs font-semibold text-slate-800">
          {last !== null ? last.toLocaleString('ja-JP') : '−'}
        </p>
      </div>
      <Sparkline data={data} color={color} />
    </div>
  );
}
