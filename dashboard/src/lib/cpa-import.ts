// 合算CPAの貼り付け取込パーサ。
// 受け付ける形式:
//  1) 合算CPA Excel「日次」シートをコピーして貼ったTSV（1行目=見出し。列名で対応付け、順序は問わない）
//  2) cpa_inputs.json 形式 { month, units:{"1":{amazon,rakuten,own}}, ad:{"1":{meta,az,rpp,google}}, sales:{"1":n} }
// 数式列（合算広告費・広告比率・合算CPA・判定・7日移動）は取り込まず、保存後に再計算する。
import type { CpaDailyRow } from './metrics/cpa';

export interface ParsedCpa {
  rows: CpaDailyRow[];
  skipped: string[];
}

const HEADER_MAP: Record<string, keyof CpaDailyRow> = {
  日付: 'date',
  スーツケース売上: 'suitcaseSales',
  売上: 'suitcaseSales',
  メタ: 'meta',
  meta: 'meta',
  amazon広告: 'amazonAds',
  amazon広告費: 'amazonAds',
  az: 'amazonAds',
  rpp: 'rpp',
  google: 'google',
  その他: 'other',
  amazon個数: 'unitsAmazon',
  楽天個数: 'unitsRakuten',
  自社個数: 'unitsOwn',
};

function toInt(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[,¥￥\s]/g, '');
  if (s === '' || s === '-' || s === '−') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** 「9/1」「2026-09-01」「2026/9/1」「1」を YYYY-MM-DD に。年月が無いときは month（YYYY-MM）を補う */
export function normalizeDate(raw: string, month: string): string | null {
  const s = String(raw).trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/月](\d{1,2})日?$/.exec(s);
  if (m) {
    const y = month.slice(0, 4);
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = /^(\d{1,2})$/.exec(s);
  if (m) return `${month}-${m[1].padStart(2, '0')}`;
  return null;
}

export function parseCpaTsv(text: string, month: string): ParsedCpa {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' '))
    .filter((l) => l.trim() !== '');
  if (!lines.length) return { rows: [], skipped: ['空です'] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
  const idx: Partial<Record<keyof CpaDailyRow, number>> = {};
  header.forEach((h, i) => {
    const key = HEADER_MAP[h] ?? HEADER_MAP[h.replace('広告費', '広告')];
    if (key && idx[key] == null) idx[key] = i;
  });
  if (idx.date == null) return { rows: [], skipped: ['1行目に「日付」列が見つかりません（Excelの見出し行ごとコピーしてください）'] };
  const rows: CpaDailyRow[] = [];
  const skipped: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep);
    const rawDate = cells[idx.date] ?? '';
    if (/^(合計|※)/.test(rawDate.trim())) continue;
    const date = normalizeDate(rawDate, month);
    if (!date) {
      skipped.push(`日付を読めません: ${rawDate.slice(0, 20)}`);
      continue;
    }
    const get = (k: keyof CpaDailyRow) => (idx[k] == null ? null : toInt(cells[idx[k] as number]));
    const row: CpaDailyRow = {
      date,
      suitcaseSales: get('suitcaseSales'),
      meta: get('meta') ?? 0,
      amazonAds: get('amazonAds') ?? 0,
      rpp: get('rpp') ?? 0,
      google: get('google') ?? 0,
      other: get('other') ?? 0,
      unitsAmazon: get('unitsAmazon') ?? 0,
      unitsRakuten: get('unitsRakuten') ?? 0,
      unitsOwn: get('unitsOwn') ?? 0,
    };
    const hasAny =
      row.suitcaseSales != null ||
      row.meta + row.amazonAds + row.rpp + row.google + row.other + row.unitsAmazon + row.unitsRakuten + row.unitsOwn > 0;
    if (!hasAny) continue; // 未入力日（Excelの空行）は取り込まない
    rows.push(row);
  }
  return { rows, skipped };
}

interface CpaInputsJson {
  month: string;
  units?: Record<string, { amazon?: number; rakuten?: number; own?: number }>;
  ad?: Record<string, { meta?: number; az?: number; amazonAds?: number; rpp?: number; google?: number; other?: number }>;
  sales?: Record<string, number>;
}

export function parseCpaJson(text: string): ParsedCpa {
  let j: CpaInputsJson;
  try {
    j = JSON.parse(text);
  } catch {
    return { rows: [], skipped: ['JSONとして読めません'] };
  }
  if (!j || typeof j.month !== 'string' || !/^\d{4}-\d{2}$/.test(j.month)) {
    return { rows: [], skipped: ['month（YYYY-MM）がありません'] };
  }
  const days = new Set<string>([...Object.keys(j.units ?? {}), ...Object.keys(j.ad ?? {}), ...Object.keys(j.sales ?? {})]);
  const rows: CpaDailyRow[] = [];
  for (const d of days) {
    const date = normalizeDate(d, j.month);
    if (!date) continue;
    const u = j.units?.[d] ?? {};
    const a = j.ad?.[d] ?? {};
    const s = j.sales?.[d];
    rows.push({
      date,
      suitcaseSales: s == null ? null : Math.round(s),
      meta: Math.round(a.meta ?? 0),
      amazonAds: Math.round(a.az ?? a.amazonAds ?? 0),
      rpp: Math.round(a.rpp ?? 0),
      google: Math.round(a.google ?? 0),
      other: Math.round(a.other ?? 0),
      unitsAmazon: Math.round(u.amazon ?? 0),
      unitsRakuten: Math.round(u.rakuten ?? 0),
      unitsOwn: Math.round(u.own ?? 0),
    });
  }
  rows.sort((x, y) => (x.date < y.date ? -1 : 1));
  return { rows, skipped: [] };
}

/** 先頭が { ならJSON、それ以外はTSV/CSV */
export function parseCpaPaste(text: string, month: string): ParsedCpa {
  const t = text.trim();
  if (t.startsWith('{')) return parseCpaJson(t);
  return parseCpaTsv(t, month);
}
