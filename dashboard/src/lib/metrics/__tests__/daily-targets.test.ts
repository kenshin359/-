import { describe, expect, it } from 'vitest';
import {
  buildDailyTargets,
  compareDailyTargets,
  judgeDaily,
  normalizeWeights,
  parseEventsCalendar,
  parseWeights,
  serializeWeights,
  weightTotal,
  type WeightMap,
} from '../daily-targets';

// events-2026-09.json（daily-report-system/config/chorei）と同じ形の重み
const SEP: WeightMap = {
  '1': { label: 'Amazonスマイルセール', weight: 2.0 },
  '2': { label: 'Amazonスマイルセール', weight: 2.0 },
  '3': { label: 'Amazonスマイルセール最終', weight: 2.0 },
  '4': { label: '楽天スーパーSALE', weight: 2.0 },
  '5': { label: '楽天スーパーSALE', weight: 2.0 },
  '6': { label: '楽天スーパーSALE', weight: 2.0 },
  '7': { label: '楽天スーパーSALE', weight: 2.0 },
  '8': { label: '楽天スーパーSALE', weight: 2.0 },
  '9': { label: '楽天スーパーSALE', weight: 2.0 },
  '10': { label: '楽天スーパーSALE', weight: 2.0 },
  '11': { label: '楽天スーパーSALE最終', weight: 1.3 },
  '19': { label: '楽天マラソン', weight: 1.7 },
  '20': { label: '楽天マラソン', weight: 1.7 },
  '21': { label: '楽天マラソン', weight: 1.7 },
  '22': { label: '楽天マラソン', weight: 1.7 },
  '23': { label: '楽天マラソン', weight: 1.7 },
  '24': { label: '楽天マラソン最終', weight: 1.2 },
};

describe('日別目標（business.md §6: 月目標 × その日の重み ÷ 月内の重み合計）', () => {
  it('重み合計 = 通常日1.0 + イベント日の重み（2026-09 は 30日）', () => {
    // 10日×2.0 + 1.3 + 5日×1.7 + 1.2 + 通常日 13日×1.0 = 20 + 1.3 + 8.5 + 1.2 + 13 = 44.0
    expect(weightTotal('2026-09', SEP)).toBeCloseTo(44.0, 6);
    expect(weightTotal('2026-09', {})).toBe(30);
  });
  it('重み未設定なら月間目標を日数で等分し、合計は月間目標にちょうど一致する', () => {
    const t = buildDailyTargets('2026-09', 110_000_000, {});
    expect(t).toHaveLength(30);
    expect(t.every((d) => d.weight === 1 && d.label === '')).toBe(true);
    expect(t.reduce((s, d) => s + d.target, 0)).toBe(110_000_000);
    // 110,000,000 / 30 = 3,666,666.67 → 3,666,666 か 3,666,667 のどちらか
    expect(t.every((d) => d.target === 3_666_666 || d.target === 3_666_667)).toBe(true);
  });
  it('イベント日は重みに比例して大きくなり、合計は月間目標に一致する', () => {
    const t = buildDailyTargets('2026-09', 110_000_000, SEP);
    const base = 110_000_000 / 44;
    const d1 = t[0];
    expect(d1.date).toBe('2026-09-01');
    expect(d1.label).toBe('Amazonスマイルセール');
    expect(d1.target).toBeCloseTo(base * 2.0, -1); // 5,000,000
    expect(t[11].weight).toBe(1); // 9/12 は通常日
    expect(t[11].target).toBeCloseTo(base, -1); // 2,500,000
    expect(t[18].label).toBe('楽天マラソン');
    expect(t[18].target).toBeCloseTo(base * 1.7, -1);
    expect(t.reduce((s, d) => s + d.target, 0)).toBe(110_000_000);
  });
  it('月間目標が未設定（0）なら全日 0 にして推測しない', () => {
    const t = buildDailyTargets('2026-09', 0, SEP);
    expect(t.every((d) => d.target === 0)).toBe(true);
  });
  it('日次判定: ≥1.0 好調 / ≥0.7 まずまず / 未満 要改善、目標0・実績無しは na', () => {
    expect(judgeDaily(5_000_000, 5_000_000)).toBe('ok');
    expect(judgeDaily(3_600_000, 5_000_000)).toBe('warn');
    expect(judgeDaily(3_400_000, 5_000_000)).toBe('danger');
    expect(judgeDaily(null, 5_000_000)).toBe('na');
    expect(judgeDaily(100, 0)).toBe('na');
  });
  it('日別実績と並べて達成率・乖離・累計乖離を出し、実績の無い日は null（0にしない）', () => {
    const w: WeightMap = { '1': { label: 'SALE', weight: 2 } };
    // 3月=31日、重み合計 32、目標 3,200,000 → 1日 200,000、他 100,000
    const s = compareDailyTargets('2026-03', 3_200_000, w, [
      { date: '2026-03-01', salesTotal: 250_000 },
      { date: '2026-03-02', salesTotal: 60_000 },
    ]);
    expect(s.weightTotal).toBe(32);
    expect(s.eventDays).toBe(1);
    expect(s.rows[0].target).toBe(200_000);
    expect(s.rows[0].gap).toBe(50_000);
    expect(s.rows[0].achievement).toEqual({ kind: 'value', value: 125 });
    expect(s.rows[0].judgement).toBe('ok');
    expect(s.rows[1].target).toBe(100_000);
    expect(s.rows[1].judgement).toBe('danger');
    expect(s.rows[1].cumGap).toBe(10_000); // (250,000+60,000) − (200,000+100,000)
    expect(s.rows[2].actual).toBeNull();
    expect(s.rows[2].gap).toBeNull();
    expect(s.rows[2].achievement).toEqual({ kind: 'na', reason: '実績なし' });
    expect(s.rows[2].cumTarget).toBe(400_000);
    expect(s.dataDays).toBe(2);
    expect(s.latestDate).toBe('2026-03-02');
    expect(s.actualToDate).toBe(310_000);
    expect(s.targetToDate).toBe(300_000);
    expect(s.gapToDate).toEqual({ kind: 'value', value: 10_000 });
    expect(s.achievementToDate.kind).toBe('value');
    if (s.achievementToDate.kind === 'value') expect(s.achievementToDate.value).toBeCloseTo(103.333, 2);
    expect(s.achievementOfMonth.kind).toBe('value');
    if (s.achievementOfMonth.kind === 'value') expect(s.achievementOfMonth.value).toBeCloseTo(9.6875, 4);
    expect(s.days).toEqual({ ok: 1, warn: 0, danger: 1 });
  });
  it('実績が1日も無ければ累計系は「データなし」', () => {
    const s = compareDailyTargets('2026-09', 110_000_000, SEP, []);
    expect(s.gapToDate).toEqual({ kind: 'na', reason: 'データなし' });
    expect(s.achievementToDate).toEqual({ kind: 'na', reason: 'データなし' });
    expect(s.actualToDate).toBe(0);
    expect(s.targetToDate).toBe(0);
  });
});

describe('重みの保存形式（Setting targets.weights.<YYYY-MM>）', () => {
  it('JSON を読み、壊れた値・範囲外の日は捨てる', () => {
    expect(parseWeights(null)).toEqual({});
    expect(parseWeights('{bad json')).toEqual({});
    expect(parseWeights('[1,2]')).toEqual({});
    const w = parseWeights(JSON.stringify({ '1': { label: 'SALE', weight: 2 }, '5': 1.7, '32': { weight: 2 }, '0': 3, '9': { weight: -1 }, '10': { weight: 'x' } }));
    expect(w).toEqual({ '1': { label: 'SALE', weight: 2 }, '5': { label: '', weight: 1.7 } });
  });
  it('保存時は通常日（1.0・ラベル無し）を省き、日付順に並べる', () => {
    const json = serializeWeights({ '19': { label: 'マラソン', weight: 1.7 }, '2': { label: '', weight: 1 }, '3': { label: 'メモ', weight: 1 }, '1': { label: '', weight: 2 } });
    expect(JSON.parse(json)).toEqual({ '1': { label: '', weight: 2 }, '3': { label: 'メモ', weight: 1 }, '19': { label: 'マラソン', weight: 1.7 } });
    expect(Object.keys(JSON.parse(json))).toEqual(['1', '3', '19']);
    expect(normalizeWeights(JSON.parse(json))).toEqual(parseWeights(json));
  });
  it('events-YYYY-MM.json（month/targets/events）を読み取る。形が違えば null', () => {
    const cal = parseEventsCalendar({
      month: '2026-09',
      targets: { main: 110000000, stretch: 120000000 },
      note: '仮置き',
      events: { '1': { label: 'Amazonスマイルセール', weight: 2.0 }, '19': { label: '楽天マラソン(20:00開始)', weight: 1.7 } },
    });
    expect(cal?.month).toBe('2026-09');
    expect(cal?.targets).toEqual({ main: 110_000_000, stretch: 120_000_000 });
    expect(cal?.note).toBe('仮置き');
    expect(cal?.weights['19']).toEqual({ label: '楽天マラソン(20:00開始)', weight: 1.7 });
    expect(parseEventsCalendar({ events: {} })).toBeNull();
    expect(parseEventsCalendar(null)).toBeNull();
    expect(parseEventsCalendar({ month: '2026-09' })?.targets).toBeNull();
  });
});
