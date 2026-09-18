import { describe, expect, it } from 'vitest';
import {
  achievementRate,
  computeMonthlyOverview,
  daysInMonthOf,
  pace,
  prevMonthOf,
  requiredDaily,
  rowFromRecord,
  type KpiDailyRow,
} from '../kpi-kintone';
import { THRESHOLDS, judgeAdRatio, judgeCount, judgePace, waitingStaleTasks } from '../overview';
import { buildAlertCandidates } from '../alerts';
import type { TaskItem } from '../../tasks';

function row(date: string, sales: number, ad: number, target: number | null = null): KpiDailyRow {
  return {
    date,
    salesRakuten: sales,
    salesAmazon: 0,
    salesOwn: 0,
    salesTotal: sales,
    target,
    adGoogle: ad,
    adRakuten: 0,
    adAmazon: 0,
    adMeta: 0,
    adTotal: ad,
    adRatio: sales > 0 ? (ad / sales) * 100 : null,
  };
}

const TARGETS = { main: 110_000_000, stretch: 120_000_000, isDefault: true };

describe('必要日販・達成率・ペース（business.md §6）', () => {
  it('必要日販 = (目標 − 累計) ÷ 残日数', () => {
    expect(requiredDaily(110_000_000, 50_000_000, 12)).toEqual({ kind: 'value', value: 5_000_000 });
  });
  it('残日数0は「月末確定」、目標到達済みは0', () => {
    expect(requiredDaily(110_000_000, 50_000_000, 0)).toEqual({ kind: 'na', reason: '月末確定' });
    expect(requiredDaily(100, 150, 5)).toEqual({ kind: 'value', value: 0 });
  });
  it('達成率 = 累計 ÷ 目標 × 100、目標0は未設定', () => {
    expect(achievementRate(55_000_000, 110_000_000)).toEqual({ kind: 'value', value: 50 });
    expect(achievementRate(1, 0).kind).toBe('na');
  });
  it('ペース = 累計 ÷ (目標 × 経過日 ÷ 月日数)', () => {
    // 30日の月で15日経過・目標1.1億 → 期待累計 5,500万。累計 5,500万ならペース1.0
    const p = pace(55_000_000, 110_000_000, 15, 30);
    expect(p.kind).toBe('value');
    if (p.kind === 'value') expect(p.value).toBeCloseTo(1.0, 6);
    expect(pace(0, 110_000_000, 0, 30).kind).toBe('na');
  });
});

describe('判定閾値', () => {
  it('ペース: ≥1.0 ok / ≥0.9 warn / 未満 danger', () => {
    expect(judgePace({ kind: 'value', value: 1.0 })).toBe('ok');
    expect(judgePace({ kind: 'value', value: 0.95 })).toBe('warn');
    expect(judgePace({ kind: 'value', value: 0.89 })).toBe('danger');
    expect(judgePace({ kind: 'na', reason: 'x' })).toBe('na');
  });
  it('広告費率: ≤15% ok / ≤20% warn / 超過 danger', () => {
    expect(judgeAdRatio({ kind: 'value', value: 15 })).toBe('ok');
    expect(judgeAdRatio({ kind: 'value', value: 18 })).toBe('warn');
    expect(judgeAdRatio({ kind: 'value', value: 20.1 })).toBe('danger');
    expect(THRESHOLDS.adRatioOkMax).toBe(15);
    expect(THRESHOLDS.adRatioWarnMax).toBe(20);
  });
  it('期限超過件数: 0 ok / 1〜2 warn / 3以上 danger', () => {
    expect(judgeCount(0, THRESHOLDS.overdueWarnAt, THRESHOLDS.overdueDangerAt)).toBe('ok');
    expect(judgeCount(2, THRESHOLDS.overdueWarnAt, THRESHOLDS.overdueDangerAt)).toBe('warn');
    expect(judgeCount(3, THRESHOLDS.overdueWarnAt, THRESHOLDS.overdueDangerAt)).toBe('danger');
  });
});

describe('computeMonthlyOverview（月次サマリー）', () => {
  const rows = [
    row('2026-09-01', 4_000_000, 600_000, 3_666_667),
    row('2026-09-02', 3_000_000, 500_000, 3_666_667),
    row('2026-09-03', 5_000_000, 700_000, 3_666_667),
  ];
  const prev = [row('2026-08-01', 3_000_000, 400_000), row('2026-08-02', 3_000_000, 400_000), row('2026-08-03', 2_000_000, 400_000), row('2026-08-04', 9_000_000, 400_000)];
  const o = computeMonthlyOverview('2026-09', rows, prev, TARGETS);

  it('本日＝最新日、累計・経過日・残日数', () => {
    expect(o.latestDate).toBe('2026-09-03');
    expect(o.todaySales).toBe(5_000_000);
    expect(o.monthToDate).toBe(12_000_000);
    expect(o.elapsedDays).toBe(3);
    expect(o.daysInMonth).toBe(30);
    expect(o.remainingDays).toBe(27);
  });
  it('必要日販・達成率・直近7日平均', () => {
    expect(o.requiredDailyMain).toEqual({ kind: 'value', value: Math.round((110_000_000 - 12_000_000) / 27) });
    expect(o.achievementRate.kind === 'value' && o.achievementRate.value).toBeCloseTo((12 / 110) * 100, 6);
    expect(o.avg7).toEqual({ kind: 'value', value: 4_000_000 });
    expect(o.avg7Days).toBe(3);
  });
  it('前月同期間比は同じ経過日数（1〜3日）で比べる（8/4は含めない）', () => {
    expect(o.prevSamePeriod).toBe(8_000_000);
    expect(o.prevSamePeriodDays).toBe(3);
    expect(o.prevSamePeriodChange.kind === 'value' && o.prevSamePeriodChange.value).toBeCloseTo(50, 6);
  });
  it('広告費率 = 広告費 ÷ 売上', () => {
    expect(o.adTotal).toBe(1_800_000);
    expect(o.adRatio.kind === 'value' && o.adRatio.value).toBeCloseTo(15, 6);
  });
  it('データなしは na（数字を作らない）', () => {
    const e = computeMonthlyOverview('2026-09', [], [], TARGETS);
    expect(e.todaySales).toBeNull();
    expect(e.achievementRate.kind).toBe('na');
    expect(e.requiredDailyMain.kind).toBe('na');
    expect(e.adRatio.kind).toBe('na');
    expect(e.prevSamePeriodChange.kind).toBe('na');
  });
  it('前月0は比較不可', () => {
    const z = computeMonthlyOverview('2026-09', rows, [row('2026-08-01', 0, 0)], TARGETS);
    expect(z.prevSamePeriodChange).toEqual({ kind: 'na', reason: '比較不可(前月0)' });
  });
});

describe('Kintone レコード変換・月ユーティリティ', () => {
  it('数値文字列を数に、空は0/null に。s_total 欠損時は3媒体の和', () => {
    const r = rowFromRecord({
      report_date: { value: '2026-09-17' },
      s_rk: { value: '1000' },
      s_az: { value: '' },
      s_own: { value: '500' },
      target: { value: '' },
      a_gg: { value: '100' },
      a_ratio: { value: '6.7' },
    });
    expect(r?.salesTotal).toBe(1500);
    expect(r?.target).toBeNull();
    expect(r?.adTotal).toBe(100);
    expect(r?.adRatio).toBe(6.7);
    expect(rowFromRecord({ report_date: { value: '' } })).toBeNull();
  });
  it('前月・月日数', () => {
    expect(prevMonthOf('2026-01')).toBe('2025-12');
    expect(prevMonthOf('2026-09')).toBe('2026-08');
    expect(daysInMonthOf('2026-02')).toBe(28);
    expect(daysInMonthOf('2026-09')).toBe(30);
  });
});

const base: TaskItem = {
  id: '1', source: 'local', team: 'CS', assignee: '笹本', title: 't', doneDef: 'd', priority: 'P2',
  impact: '○ 間接（計測・基盤）', due: null, status: '未着手', yanai: '', memo: '', updatedAt: '2026-09-17T09:00:00+09:00',
};
const now = new Date('2026-09-18T03:00:00Z'); // JST 9/18 12:00

describe('アラートルール（pro-plan §5⑧）', () => {
  it('期限超過は🔴、確認待ち3日以上・担当未設定・14日未更新・8件集中は🟡', () => {
    const tasks: TaskItem[] = [
      { ...base, id: 'a', due: '2026-09-16', priority: 'P1' },
      { ...base, id: 'b', status: '確認待ち', updatedAt: '2026-09-10T09:00:00+09:00' },
      { ...base, id: 'c', assignee: '' },
      { ...base, id: 'd', status: '進行中', updatedAt: '2026-08-20T09:00:00+09:00' },
      { ...base, id: 'e', due: '2026-01-01', status: '完了' },
      ...Array.from({ length: 8 }, (_, i) => ({ ...base, id: `k${i}`, assignee: '北野', team: '経営' })),
    ];
    const c = buildAlertCandidates({ tasks, monthly: null, now });
    const codes = c.map((x) => `${x.code}:${x.entityId}`);
    expect(codes).toContain('task_overdue:a');
    expect(c.find((x) => x.code === 'task_overdue')?.level).toBe('red');
    expect(c.find((x) => x.code === 'task_overdue')?.teamCode).toBe('cs');
    expect(codes).toContain('waiting_stale:b');
    expect(codes).toContain('no_assignee:c');
    expect(codes).toContain('stale_update:d');
    expect(codes).toContain('task_concentration:北野');
    expect(codes.some((k) => k.endsWith(':e'))).toBe(false);
    expect(c.some((x) => x.code === 'sales_pace' || x.code === 'ad_ratio')).toBe(false);
    expect(waitingStaleTasks(tasks, now).map((t) => t.id)).toEqual(['b']);
  });
  it('売上ペース <0.9 は🔴、広告費率 >15% は🟡・>20% は🔴', () => {
    const slow = computeMonthlyOverview('2026-09', [row('2026-09-15', 40_000_000, 9_000_000)], [], TARGETS);
    const c = buildAlertCandidates({ tasks: [], monthly: slow, now });
    expect(c.find((x) => x.code === 'sales_pace')?.level).toBe('red');
    expect(c.find((x) => x.code === 'ad_ratio')?.level).toBe('red');
    const fine = computeMonthlyOverview('2026-09', [row('2026-09-15', 60_000_000, 10_000_000)], [], TARGETS);
    const c2 = buildAlertCandidates({ tasks: [], monthly: fine, now });
    expect(c2.some((x) => x.code === 'sales_pace')).toBe(false);
    expect(c2.find((x) => x.code === 'ad_ratio')?.level).toBe('yellow');
  });
});
