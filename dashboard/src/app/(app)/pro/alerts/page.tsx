// PRO: アラートセンター。ページ表示時にルールを評価してから一覧する（タスク数は数百件以下）。
// 一般社員は自チーム分のみ、リーダー以上は全社。解決・ミュートはリーダー以上（サーバーで再検証）。
import type { Metadata } from 'next';
import { requireActor, atLeast, canSeeCompanyWide } from '@/lib/rbac';
import { evaluateAlerts, listOpenAlerts } from '@/lib/pro/alerts';
import { fetchKpiMonths, computeMonthlyOverview } from '@/lib/pro/kpi-kintone';
import { THRESHOLDS } from '@/lib/pro/overview';
import { prisma } from '@/lib/prisma';
import { jstDateKey } from '@/lib/metrics/format';
import { getCreativeData } from '@/lib/creative-data';
import AlertCenter from './AlertCenter';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'アラートセンター' };

export default async function AlertsPage() {
  const actor = await requireActor();
  const now = new Date();
  const month = jstDateKey(now).slice(0, 7);

  // KPI(30) が取れるときだけ売上ペース・広告費率のルールも評価する（未接続時はタスク系のみ）
  const [kpi, targetRows, creative] = await Promise.all([
    fetchKpiMonths(month),
    prisma.target.findMany({ where: { month, scope: 'all', scopeCode: 'all', metric: { in: ['sales', 'sales_stretch'] } } }),
    getCreativeData(now).catch(() => null),
  ]);
  const main = targetRows.find((t) => t.metric === 'sales')?.amount ?? null;
  const stretch = targetRows.find((t) => t.metric === 'sales_stretch')?.amount ?? null;
  const monthly =
    kpi.status === 'ok'
      ? computeMonthlyOverview(month, kpi.rows, kpi.prevRows, {
          main: main ?? THRESHOLDS.targetMainDefault,
          stretch: stretch ?? THRESHOLDS.targetStretchDefault,
          isDefault: main == null,
        })
      : null;

  let evalNotice: string | null = null;
  try {
    await evaluateAlerts({ monthly, creative: creative?.status === 'ok' ? creative.list : null, now });
  } catch (e) {
    evalNotice = `ルール評価に失敗しました: ${e instanceof Error ? e.message : String(e)}`;
  }
  const alerts = await listOpenAlerts(actor, now);

  return (
    <AlertCenter
      alerts={alerts}
      canManage={atLeast(actor.level, 'leader')}
      scope={canSeeCompanyWide(actor.level) ? 'company' : 'team'}
      kpiStatus={kpi.status === 'ok' ? { status: 'ok', appId: kpi.appId } : { status: 'unavailable', appId: kpi.appId, reason: kpi.reason }}
      evalNotice={evalNotice}
    />
  );
}
