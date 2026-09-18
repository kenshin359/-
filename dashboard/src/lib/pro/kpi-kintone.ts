// Kintone「毎朝KPI報告（広告費・売上）」(30) の読み取り（サーバー専用・読み取りのみ）。
// 1レコード = 1日。項目は daily-report-system/kintone/kpiSchema.js と同一:
//   report_date / s_rk / s_az / s_own / s_total / target / a_gg / a_rk / a_az / a_meta / a_total / a_ratio
//
//  KINTONE_BASE_URL          例: https://xxxx.cybozu.com
//  KINTONE_KPI_APP_ID        アプリ番号（既定 30）
//  KINTONE_API_TOKEN_KPI     上記アプリのAPIトークン（レコード閲覧）。無ければ KINTONE_USER / KINTONE_PASSWORD
//
// 数字は一切作らない。未接続・失敗時は {status:'unavailable', reason} を返し、画面は「未接続」「未取得」を出す。
import { kintoneApi, KintoneError, type KintoneRecord } from '../kintone';
import { prisma } from '../prisma';
import type { MetricValue } from '../metrics/types';

export interface KpiDailyRow {
  /** YYYY-MM-DD（report_date） */
  date: string;
  salesRakuten: number;
  salesAmazon: number;
  salesOwn: number;
  /** s_total（Kintone側の自動計算。空なら3媒体の和） */
  salesTotal: number;
  /** 日別目標（計画シートの値）。未入力は null */
  target: number | null;
  adGoogle: number;
  adRakuten: number;
  adAmazon: number;
  adMeta: number;
  adTotal: number;
  /** a_ratio（%）。売上0のときKintoneは0を返すので null に落とす */
  adRatio: number | null;
}

export type KpiFetchResult =
  | {
      status: 'ok';
      appId: string;
      month: string;
      rows: KpiDailyRow[];
      prevMonth: string;
      prevRows: KpiDailyRow[];
      /** kintone=直接読み取り / cache=GitHub Actions 等から取り込んだ日次キャッシュ（KpiDaily） */
      source: 'kintone' | 'cache';
      /** cache のとき: 最終取込日時 */
      cachedAt?: string | null;
    }
  | { status: 'unavailable'; appId: string; reason: string };

function kpiToken(): string {
  return (process.env.KINTONE_API_TOKEN_KPI || '').trim();
}

/** KPI報告アプリの接続設定が揃っているか（値は返さない） */
export function kpiKintoneConfigured(): boolean {
  const base = (process.env.KINTONE_BASE_URL || '').trim();
  if (!base) return false;
  if (kpiToken()) return true;
  return Boolean((process.env.KINTONE_USER || '').trim() && process.env.KINTONE_PASSWORD);
}

export function kpiKintoneAppId(): string {
  return (process.env.KINTONE_KPI_APP_ID || '30').trim();
}

function num(r: KintoneRecord, code: string): number | null {
  const v = r[code]?.value;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowFromRecord(r: KintoneRecord): KpiDailyRow | null {
  const date = String(r.report_date?.value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const salesRakuten = num(r, 's_rk') ?? 0;
  const salesAmazon = num(r, 's_az') ?? 0;
  const salesOwn = num(r, 's_own') ?? 0;
  const adGoogle = num(r, 'a_gg') ?? 0;
  const adRakuten = num(r, 'a_rk') ?? 0;
  const adAmazon = num(r, 'a_az') ?? 0;
  const adMeta = num(r, 'a_meta') ?? 0;
  const salesTotal = num(r, 's_total') ?? salesRakuten + salesAmazon + salesOwn;
  const adTotal = num(r, 'a_total') ?? adGoogle + adRakuten + adAmazon + adMeta;
  const ratioRaw = num(r, 'a_ratio');
  return {
    date,
    salesRakuten,
    salesAmazon,
    salesOwn,
    salesTotal,
    target: num(r, 'target'),
    adGoogle,
    adRakuten,
    adAmazon,
    adMeta,
    adTotal,
    adRatio: salesTotal > 0 ? ratioRaw : null,
  };
}

/** YYYY-MM の前月 */
export function prevMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM の日数 */
export function daysInMonthOf(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonthOf(month)).padStart(2, '0')}` };
}

/** 指定月のレコードを日付昇順で取得（最大500件＝1ヶ月は31件なので1ページで足りる） */
export async function fetchDailyKpi(month: string): Promise<KpiDailyRow[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`月の形式が不正です: ${month}`);
  const { from, to } = monthRange(month);
  const query = `report_date >= "${from}" and report_date <= "${to}" order by report_date asc limit 500`;
  const res = await kintoneApi<{ records: KintoneRecord[] }>(
    'GET',
    `/k/v1/records.json?app=${encodeURIComponent(kpiKintoneAppId())}&query=${encodeURIComponent(query)}`,
    undefined,
    kpiToken(),
  );
  const rows: KpiDailyRow[] = [];
  for (const r of res.records ?? []) {
    const row = rowFromRecord(r);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

function describeError(e: unknown): string {
  if (e instanceof KintoneError) {
    if (e.code === 'NOT_CONFIGURED') return 'Kintone未接続（KINTONE_BASE_URL / KINTONE_API_TOKEN_KPI が未設定）';
    if (e.status === 401 || e.status === 403) return 'Kintoneの認証に失敗しました（KPI報告アプリのAPIトークン権限を確認）';
    if (e.status === 404) return `Kintoneにアプリ ${kpiKintoneAppId()} が見つかりません（KINTONE_KPI_APP_ID を確認）`;
    return `Kintone接続エラー: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** 日次キャッシュ（KpiDaily）から月を読む。無ければ空配列 */
async function cachedDailyKpi(month: string): Promise<{ rows: KpiDailyRow[]; cachedAt: Date | null }> {
  const list = await prisma.kpiDaily.findMany({ where: { date: { startsWith: month + '-' } }, orderBy: { date: 'asc' } });
  let cachedAt: Date | null = null;
  const rows = list.map((r) => {
    if (!cachedAt || r.updatedAt > cachedAt) cachedAt = r.updatedAt;
    const salesTotal = r.salesRakuten + r.salesAmazon + r.salesOwn;
    const adTotal = r.adGoogle + r.adRakuten + r.adAmazon + r.adMeta;
    return {
      date: r.date,
      salesRakuten: r.salesRakuten,
      salesAmazon: r.salesAmazon,
      salesOwn: r.salesOwn,
      salesTotal,
      target: r.target,
      adGoogle: r.adGoogle,
      adRakuten: r.adRakuten,
      adAmazon: r.adAmazon,
      adMeta: r.adMeta,
      adTotal,
      adRatio: salesTotal > 0 ? Math.round((adTotal / salesTotal) * 1000) / 10 : null,
    } satisfies KpiDailyRow;
  });
  return { rows, cachedAt };
}

/**
 * 当月と前月を取得（前月同期間比のため）。
 * Kintone が使えれば直接読み、未接続・失敗時は日次キャッシュ（/api/pro/ingest で取り込んだ値）にフォールバック。
 * どちらも無ければ unavailable（画面は「未接続」「未取得」を出す。推測で埋めない）。
 */
export async function fetchKpiMonths(month: string): Promise<KpiFetchResult> {
  const appId = kpiKintoneAppId();
  const prevMonth = prevMonthOf(month);
  let reason = 'Kintone未接続（KINTONE_BASE_URL / KINTONE_API_TOKEN_KPI が未設定）';
  if (kpiKintoneConfigured()) {
    try {
      const [rows, prevRows] = await Promise.all([fetchDailyKpi(month), fetchDailyKpi(prevMonth)]);
      return { status: 'ok', appId, month, rows, prevMonth, prevRows, source: 'kintone' };
    } catch (e) {
      reason = describeError(e);
    }
  }
  try {
    const [cur, prev] = await Promise.all([cachedDailyKpi(month), cachedDailyKpi(prevMonth)]);
    if (cur.rows.length || prev.rows.length) {
      const cachedAt = [cur.cachedAt, prev.cachedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return { status: 'ok', appId, month, rows: cur.rows, prevMonth, prevRows: prev.rows, source: 'cache', cachedAt: cachedAt ? cachedAt.toISOString() : null };
    }
  } catch {
    /* キャッシュ読み取り失敗は unavailable として扱う */
  }
  return { status: 'unavailable', appId, reason: `${reason}。取込済みの日次データもありません` };
}

// ───────────────────────── 純関数（テスト対象） ─────────────────────────

export interface MonthTargets {
  /** メイン目標（円） */
  main: number;
  /** ストレッチ目標（円） */
  stretch: number;
  /** DBの目標が無く既定値を使ったとき true（画面に「仮置き」と出す） */
  isDefault: boolean;
}

export interface MonthlyOverview {
  month: string;
  daysInMonth: number;
  /** 取得できた日数 */
  dataDays: number;
  /** 最新のデータ日（YYYY-MM-DD）。データが無ければ null */
  latestDate: string | null;
  /** 経過日数＝最新データ日の日（1〜31）。データ無しは 0 */
  elapsedDays: number;
  remainingDays: number;
  /** 本日（＝最新日）の売上 */
  todaySales: number | null;
  todayTarget: number | null;
  /** 最新日の媒体別 */
  todayByChannel: { rakuten: number; amazon: number; own: number } | null;
  monthToDate: number;
  byChannel: { rakuten: number; amazon: number; own: number };
  targets: MonthTargets;
  /** 累計 ÷ メイン目標（%） */
  achievementRate: MetricValue;
  /** ペース＝累計 ÷ (目標 × 経過日 ÷ 月日数)。1.0で計画どおり */
  pace: MetricValue;
  /** (目標 − 累計) ÷ 残日数 */
  requiredDailyMain: MetricValue;
  requiredDailyStretch: MetricValue;
  /** 直近7日（データのある日のうち最新7日）の平均日販 */
  avg7: MetricValue;
  avg7Days: number;
  /** 前月の同じ経過日までの累計 */
  prevSamePeriod: number | null;
  prevSamePeriodDays: number;
  /** 前月同期間比（%増減） */
  prevSamePeriodChange: MetricValue;
  adTotal: number;
  adByMedia: { google: number; rakuten: number; amazon: number; meta: number };
  /** 広告費 ÷ 売上 × 100 */
  adRatio: MetricValue;
}

const na = (reason: string): MetricValue => ({ kind: 'na', reason });
const val = (value: number): MetricValue => ({ kind: 'value', value });

/** 必要日販: (目標 − 累計) ÷ 残日数。残日数0は「月末確定」。目標到達済みは 0 */
export function requiredDaily(target: number, monthToDate: number, remainingDays: number): MetricValue {
  if (remainingDays <= 0) return na('月末確定');
  return val(Math.max(0, Math.round((target - monthToDate) / remainingDays)));
}

/** 達成率（%）: 累計 ÷ 目標。目標0は「目標未設定」 */
export function achievementRate(monthToDate: number, target: number): MetricValue {
  if (target <= 0) return na('目標未設定');
  return val((monthToDate / target) * 100);
}

/** ペース: 累計 ÷ (目標 × 経過日 ÷ 月日数) */
export function pace(monthToDate: number, target: number, elapsedDays: number, daysInMonth: number): MetricValue {
  if (target <= 0) return na('目標未設定');
  if (elapsedDays <= 0 || daysInMonth <= 0) return na('データなし');
  const expected = (target * elapsedDays) / daysInMonth;
  if (expected <= 0) return na('データなし');
  return val(monthToDate / expected);
}

export function computeMonthlyOverview(
  month: string,
  rows: KpiDailyRow[],
  prevRows: KpiDailyRow[],
  targets: MonthTargets,
): MonthlyOverview {
  const daysInMonth = daysInMonthOf(month);
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const elapsedDays = latest ? Number(latest.date.slice(8, 10)) : 0;
  const remainingDays = Math.max(0, daysInMonth - elapsedDays);

  const byChannel = { rakuten: 0, amazon: 0, own: 0 };
  const adByMedia = { google: 0, rakuten: 0, amazon: 0, meta: 0 };
  let monthToDate = 0;
  let adTotal = 0;
  for (const r of sorted) {
    monthToDate += r.salesTotal;
    byChannel.rakuten += r.salesRakuten;
    byChannel.amazon += r.salesAmazon;
    byChannel.own += r.salesOwn;
    adTotal += r.adTotal;
    adByMedia.google += r.adGoogle;
    adByMedia.rakuten += r.adRakuten;
    adByMedia.amazon += r.adAmazon;
    adByMedia.meta += r.adMeta;
  }

  const last7 = sorted.slice(-7);
  const avg7 = last7.length ? val(Math.round(last7.reduce((s, r) => s + r.salesTotal, 0) / last7.length)) : na('データなし');

  // 前月同期間: 前月の 1日〜経過日 と同じ日数の累計
  const prevSame = elapsedDays > 0 ? prevRows.filter((r) => Number(r.date.slice(8, 10)) <= elapsedDays) : [];
  const prevSamePeriod = prevSame.length ? prevSame.reduce((s, r) => s + r.salesTotal, 0) : null;
  let prevSamePeriodChange: MetricValue;
  if (!latest) prevSamePeriodChange = na('データなし');
  else if (prevSamePeriod == null) prevSamePeriodChange = na('前月データなし');
  else if (prevSamePeriod === 0) prevSamePeriodChange = na('比較不可(前月0)');
  else prevSamePeriodChange = val(((monthToDate - prevSamePeriod) / prevSamePeriod) * 100);

  return {
    month,
    daysInMonth,
    dataDays: sorted.length,
    latestDate: latest?.date ?? null,
    elapsedDays,
    remainingDays,
    todaySales: latest ? latest.salesTotal : null,
    todayTarget: latest?.target ?? null,
    todayByChannel: latest ? { rakuten: latest.salesRakuten, amazon: latest.salesAmazon, own: latest.salesOwn } : null,
    monthToDate,
    byChannel,
    targets,
    achievementRate: latest ? achievementRate(monthToDate, targets.main) : na('データなし'),
    pace: pace(monthToDate, targets.main, elapsedDays, daysInMonth),
    requiredDailyMain: latest ? requiredDaily(targets.main, monthToDate, remainingDays) : na('データなし'),
    requiredDailyStretch: latest ? requiredDaily(targets.stretch, monthToDate, remainingDays) : na('データなし'),
    avg7,
    avg7Days: last7.length,
    prevSamePeriod,
    prevSamePeriodDays: prevSame.length,
    prevSamePeriodChange,
    adTotal,
    adByMedia,
    adRatio: monthToDate > 0 ? val((adTotal / monthToDate) * 100) : na(latest ? '売上0のため算出不可' : 'データなし'),
  };
}
