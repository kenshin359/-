// 5フィールド cron（分 時 日 月 曜日）の最小マッチャ。JST で評価する。
// 対応: `*`, `*/n`, `a-b`, `a-b/n`, `a,b,c`（混在可）。曜日は 0-7（0 と 7 は日曜）。
// Vercel Cron は数分遅れることがあるため、「直近 window 分以内に一致した分があったか」で判定する。

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>; // 1-31
  month: Set<number>; // 1-12
  dow: Set<number>; // 0-6
  domStar: boolean;
  dowStar: boolean;
}

function parseField(field: string, min: number, max: number, wrap7to0 = false): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const p = part.trim();
    if (!p) return null;
    const m = p.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let lo: number;
    let hi: number;
    if (m[1] === '*') {
      lo = min;
      hi = max;
    } else if (m[1].includes('-')) {
      const [a, b] = m[1].split('-').map(Number);
      lo = a;
      hi = b;
    } else {
      lo = Number(m[1]);
      hi = m[2] ? max : lo;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(wrap7to0 && v === 7 ? 0 : v);
  }
  return out;
}

/** 文字列 → CronSpec。不正なら null */
export function parseCron(expr: string): CronSpec | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = parseField(f[0], 0, 59);
  const hour = parseField(f[1], 0, 23);
  const dom = parseField(f[2], 1, 31);
  const month = parseField(f[3], 1, 12);
  const dow = parseField(f[4], 0, 7, true);
  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow, domStar: f[2] === '*', dowStar: f[4] === '*' };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

interface Parts {
  minute: number;
  hour: number;
  dom: number;
  month: number;
  dow: number;
}

function jstParts(t: Date): Parts {
  const j = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  return { minute: j.getUTCMinutes(), hour: j.getUTCHours(), dom: j.getUTCDate(), month: j.getUTCMonth() + 1, dow: j.getUTCDay() };
}

function matchParts(spec: CronSpec, p: Parts): boolean {
  if (!spec.minute.has(p.minute) || !spec.hour.has(p.hour) || !spec.month.has(p.month)) return false;
  // 標準 cron と同じ: 日と曜日の両方が指定されていれば OR、片方だけなら AND
  const domOk = spec.dom.has(p.dom);
  const dowOk = spec.dow.has(p.dow);
  if (!spec.domStar && !spec.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

/** その時刻（分単位・JST）に一致するか */
export function cronMatches(expr: string | CronSpec, at: Date): boolean {
  const spec = typeof expr === 'string' ? parseCron(expr) : expr;
  if (!spec) return false;
  return matchParts(spec, jstParts(at));
}

function floorMinute(t: Date): Date {
  return new Date(Math.floor(t.getTime() / 60_000) * 60_000);
}

/** now 以前で直近の一致分（now から windowMinutes 分以内）。なければ null */
export function lastMatchWithin(expr: string | CronSpec, now: Date, windowMinutes: number): Date | null {
  const spec = typeof expr === 'string' ? parseCron(expr) : expr;
  if (!spec) return null;
  let t = floorMinute(now);
  for (let i = 0; i <= windowMinutes; i++) {
    if (matchParts(spec, jstParts(t))) return t;
    t = new Date(t.getTime() - 60_000);
  }
  return null;
}

/** now より後の次の一致分。maxDays 日以内に無ければ null */
export function nextMatch(expr: string | CronSpec, now: Date, maxDays = 8): Date | null {
  const spec = typeof expr === 'string' ? parseCron(expr) : expr;
  if (!spec) return null;
  let t = new Date(floorMinute(now).getTime() + 60_000);
  const limit = maxDays * 24 * 60;
  for (let i = 0; i < limit; i++) {
    const p = jstParts(t);
    // 時・分が合わない場合はまとめて進めて計算量を抑える
    if (!spec.hour.has(p.hour)) {
      t = new Date(t.getTime() + (60 - p.minute) * 60_000);
      i += 59 - p.minute;
      continue;
    }
    if (matchParts(spec, p)) return t;
    t = new Date(t.getTime() + 60_000);
  }
  return null;
}

/** 定時投稿を今回の cron 実行で流すべきか（重複実行を防ぐ） */
export function shouldFire(expr: string, now: Date, lastRunAt: Date | null, windowMinutes = 15): { fire: boolean; slot: Date | null } {
  const slot = lastMatchWithin(expr, now, windowMinutes);
  if (!slot) return { fire: false, slot: null };
  if (lastRunAt && lastRunAt.getTime() >= slot.getTime()) return { fire: false, slot };
  return { fire: true, slot };
}
