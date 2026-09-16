'use client';

// Recharts はクライアント側のみ。データはサーバーで集計済みのものを受け取る。
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const yen = (v: number) => `¥${v.toLocaleString('ja-JP')}`;
const yenShort = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;

export function ChannelBarChart({ data }: { data: { name: string; sales: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <XAxis type="number" tickFormatter={yenShort} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => yen(Number(v))} />
        <Bar isAnimationActive={false} dataKey="sales" fill="#1d4ed8" radius={[0, 4, 4, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyLineChart({
  data,
}: {
  data: { day: string; current: number | null; previous: number | null }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={yenShort} tick={{ fontSize: 11 }} width={44} />
        <Tooltip formatter={(v) => yen(Number(v))} />
        <Line isAnimationActive={false} name="今期" dataKey="current" stroke="#1d4ed8" strokeWidth={2} dot={false} />
        <Line
          isAnimationActive={false}
          name="前期"
          dataKey="previous"
          stroke="#94a3b8"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data, color = '#1d4ed8' }: { data: { date: string; v: number }[]; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={44}>
      <LineChart data={data}>
        <Tooltip
          formatter={(v) => Number(v).toLocaleString('ja-JP')}
          labelFormatter={(l) => `${l}`}
          contentStyle={{ fontSize: 11 }}
        />
        <Line isAnimationActive={false} dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 利益構造ウォーターフォール（積み上げ棒で疑似表現） */
export function WaterfallChart({
  steps,
}: {
  steps: { name: string; value: number }[];
}) {
  // 各段の「浮き」を前段までの累計で計算
  let running = 0;
  const rows = steps.map((s, idx) => {
    const isTotal = idx === 0 || idx === steps.length - 1;
    const base = isTotal ? 0 : Math.min(running, running + s.value);
    if (idx === 0) running = s.value;
    else if (!isTotal) running += s.value;
    return {
      name: s.name,
      base,
      delta: Math.abs(isTotal ? (idx === 0 ? s.value : running) : s.value),
      negative: s.value < 0 && !isTotal,
    };
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ left: 8, right: 8 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
        <YAxis tickFormatter={yenShort} tick={{ fontSize: 11 }} width={44} />
        <Tooltip formatter={(v) => yen(Number(v))} />
        <Bar isAnimationActive={false} dataKey="base" stackId="w" fill="transparent" />
        <Bar isAnimationActive={false} dataKey="delta" stackId="w" radius={[3, 3, 0, 0]}>
          {rows.map((r, i) => (
            <Cell
              key={i}
              fill={i === 0 ? '#1d4ed8' : i === rows.length - 1 ? '#15803d' : r.negative ? '#dc2626' : '#1d4ed8'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
