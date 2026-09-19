// 日別売上CSV（KpiDaily から）。ログイン必須（未ログインは 401）。UTF-8 BOM 付きで Excel でそのまま開ける。
// 数字は取込値のみ（率は分子÷分母を src/lib/metrics/daily-sales-csv.ts で計算。売上0の日は空欄）。
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getKpiDailyRows } from '@/lib/ad-data';
import { buildDailySalesCsv, csvFileName } from '@/lib/metrics/daily-sales-csv';
import { jstDateKey } from '@/lib/metrics/format';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const raw = url.searchParams.get('month') ?? '';
  const month = raw === '' ? jstDateKey(new Date()).slice(0, 7) : raw;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'month は YYYY-MM 形式で指定してください' }, { status: 400 });
  }

  const rows = await getKpiDailyRows(month);
  const csv = buildDailySalesCsv(rows);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName(month)}"`,
      'Cache-Control': 'no-store',
      'X-Row-Count': String(rows.length),
    },
  });
}
