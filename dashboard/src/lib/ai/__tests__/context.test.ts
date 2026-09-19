// AIアシスタントの「会社の状態」テキストの検算: 機密（粗利）の除外・未取得の明記・出典の付与・上限
import { describe, expect, it } from 'vitest';
import { CONTEXT_LIMITS, SOURCES, SYSTEM_RULES, buildCompanyContext, buildSystemPrompt, type AiContextInput } from '../context';
import type { CompanyOverview } from '../../pro/overview';
import type { AlertItem } from '../../pro/alerts';
import type { KpiSummary } from '../../pro/kpi';
import type { ReportItem } from '../../pro/reports';
import type { ProductLine } from '../../metrics/product-sales';

function overview(canSeeProfit: boolean): CompanyOverview {
  return {
    month: '2026-09',
    today: '2026-09-19',
    kpi: { status: 'ok', appId: '30', latestDate: '2026-09-18', dataDays: 18, source: 'kintone', cachedAt: null },
    monthly: null,
    tasks: { source: 'kintone', notice: null, open: 42, overdue: 3, waitingStale: 1 },
    alerts: { red: 2, yellow: 5 },
    tiles: [
      { key: 'month_sales', label: '今月売上（累計）', value: '¥61,234,567', sub: '18日分', judgment: 'warn', reason: '計画ペース比 93%', href: null },
      {
        key: 'gross_profit',
        label: '粗利（暫定）',
        value: canSeeProfit ? '¥12,345,678' : '非表示',
        sub: canSeeProfit ? '売上明細より' : '管理職以上のみ閲覧できます',
        judgment: 'na',
        reason: canSeeProfit ? '判定基準は未設定' : '機密項目',
        href: null,
      },
      { key: 'inventory', label: '在庫金額', value: '未取得', sub: null, judgment: 'na', reason: '在庫報告(35)は未連携', href: '/inventory' },
    ],
    decisions: [{ kind: 'task', level: 'red', title: 'P1 期限超過: 楽天マラソン準備', detail: '広告 / 山田 / 期限 2026-09-15', href: '/tasks' }],
    teams: [
      { code: 'ads', name: '広告', leader: null, open: 10, overdue: 2, waiting: 1, href: '/pro/teams/ads' },
      { code: 'ec', name: 'EC・物販', leader: null, open: null, overdue: null, waiting: null, href: '/pro/teams/ec' },
    ],
    canSeeProfit,
  };
}

const alerts: AlertItem[] = Array.from({ length: 12 }, (_, i) => ({
  id: `a${i}`,
  code: i < 3 ? 'task_overdue' : 'no_assignee',
  level: i < 3 ? 'red' : 'yellow',
  title: `アラート${i}`,
  detail: null,
  entityType: 'task',
  entityId: `t${i}`,
  teamCode: 'ads',
  teamName: '広告',
  href: '/tasks',
  firstSeenAt: '2026-09-18T00:00:00.000Z',
  lastSeenAt: '2026-09-19T00:00:00.000Z',
  mutedUntil: null,
}));

const kpis: KpiSummary[] = [
  {
    code: 'suitcase_cpa',
    name: '合算CPA',
    unit: '円',
    direction: 'down',
    targetValue: 4500,
    warnThreshold: 4500,
    dangerThreshold: 6000,
    source: 'manual',
    teamCode: 'ads',
    ownerUserId: null,
    note: null,
    active: true,
    latest: { date: '2026-09-18', value: 5200, note: null },
    judgment: 'yellow',
    series: [],
    delta: null,
    linkedOpen: 2,
  },
  {
    code: 'roas',
    name: 'ROAS',
    unit: '倍',
    direction: 'up',
    targetValue: null,
    warnThreshold: null,
    dangerThreshold: 2,
    source: 'manual',
    teamCode: 'ads',
    ownerUserId: null,
    note: null,
    active: true,
    latest: null,
    judgment: 'na',
    series: [],
    delta: null,
    linkedOpen: 0,
  },
];

const reports: ReportItem[] = [
  {
    id: 'r1',
    type: 'weekly',
    teamCode: 'ads',
    teamName: '広告',
    authorUserId: null,
    authorName: '山田',
    periodFrom: '2026-09-08',
    periodTo: '2026-09-14',
    title: '広告 週報 9/8〜9/14',
    body: { numbers: '', learned: '', next: '', issues: '', requests: '' },
    status: 'submitted',
    reviewedByUserId: null,
    reviewedByName: null,
    reviewedAt: null,
    createdAt: '2026-09-15T00:00:00.000Z',
  },
];

const products: ProductLine[] = [
  {
    product: 'スーツケースM',
    byChannel: { Amazon: { amount: 1_000_000, units: 40 }, 楽天: { amount: 2_000_000, units: 80 }, 自社サイト: { amount: 500_000, units: 20 }, その他: { amount: 0, units: 0 } },
    total: { amount: 3_500_000, units: 140 },
    share: { kind: 'value', value: 70 },
    aov: { kind: 'value', value: 25_000 },
  },
];

function input(level: AiContextInput['actor']['level'], ov: CompanyOverview | null = overview(level === 'manager' || level === 'ceo' || level === 'director')): AiContextInput {
  return { actor: { name: 'テスト', level }, today: '2026-09-19', overview: ov, alerts, kpis, reports, products };
}

describe('機密（粗利）の除外', () => {
  it('一般社員（staff）には粗利の行を一切含めない', () => {
    const text = buildCompanyContext(input('staff'));
    expect(text).not.toContain('粗利');
    expect(text).not.toContain('¥12,345,678');
    expect(text).toContain('機密項目は非表示');
    // 機密でない数字は入る
    expect(text).toContain('¥61,234,567');
  });

  it('リーダー（leader）も管理職未満なので粗利を含めない', () => {
    const text = buildCompanyContext(input('leader'));
    expect(text).not.toContain('粗利');
  });

  it('管理職（manager）以上には粗利の値を含める', () => {
    for (const level of ['manager', 'director', 'ceo'] as const) {
      const text = buildCompanyContext(input(level));
      expect(text).toContain('粗利（暫定）: ¥12,345,678');
      expect(text).not.toContain('機密項目は非表示');
    }
  });
});

describe('未取得の明記と出典', () => {
  it('取れなかったセクションは「未取得」と書き、数字を作らない', () => {
    const text = buildCompanyContext({ actor: { name: 'テスト', level: 'ceo' }, today: '2026-09-19', overview: null, alerts: null, kpis: null, reports: null, products: null });
    expect(text).toContain('未取得（経営ダッシュボードの集計が取得できませんでした）');
    // タスク・アラート・KPI・報告・商品の5セクションが「未取得」
    expect(text.split('\n').filter((l) => l === '未取得').length).toBe(5);
    expect(text).not.toMatch(/¥\d/);
  });

  it('各セクションに画面名（出典）が付く', () => {
    const text = buildCompanyContext(input('ceo'));
    for (const s of Object.values(SOURCES)) expect(text).toContain(`［出典: ${s}］`);
  });

  it('KPIの値が無ければ「未取得」、商品はチャネル別の金額が入る', () => {
    const text = buildCompanyContext(input('ceo'));
    expect(text).toContain('合算CPA: ¥5,200（2026-09-18） ／ 目標 ¥4,500 ／ 判定: 注意 ／ 改善タスク 2件');
    expect(text).toContain('ROAS: 未取得');
    expect(text).toContain('スーツケースM: ¥3,500,000・140個（楽天 ¥2,000,000 / Amazon ¥1,000,000 / 自社 ¥500,000）／ 構成比 70.0%');
    expect(text).toContain('週報「広告 週報 9/8〜9/14」 広告／山田／2026-09-08〜2026-09-14');
  });

  it('アラートは上限件数まで（🔴優先の順序は入力どおり）', () => {
    const text = buildCompanyContext(input('ceo'));
    expect(text).toContain(`重要🔴 3件 ／ 注意🟡 9件（上位${CONTEXT_LIMITS.alerts}件を表示）`);
    expect(text).toContain('アラート9');
    expect(text).not.toContain('アラート10');
  });

  it('部署カードは集計できる部署（open が null でない）だけ載せる', () => {
    const text = buildCompanyContext(input('ceo'));
    expect(text).toContain('- 広告: 10件 / 2件 / 1件');
    expect(text).not.toContain('EC・物販');
  });
});

describe('system プロンプト', () => {
  it('ルール（推測禁止・未取得・出典）の後に会社の状態を連結する', () => {
    const ctx = buildCompanyContext(input('ceo'));
    const sys = buildSystemPrompt(ctx);
    expect(sys.startsWith(SYSTEM_RULES)).toBe(true);
    expect(sys.endsWith(ctx)).toBe(true);
    expect(SYSTEM_RULES).toContain('未取得');
    expect(SYSTEM_RULES).toContain('推測で数字を作らない');
    expect(SYSTEM_RULES).toContain('出典');
  });
});
