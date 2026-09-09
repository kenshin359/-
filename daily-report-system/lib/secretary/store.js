// ============================================================
//  AI秘書：毎日の予定と実績をためて、クセを分析する
// ------------------------------------------------------------
//  保存先は state/secretary/YYYY-MM-DD.json（1日1ファイル）。
//  ★ このフォルダは .gitignore で除外されており、GitHubには上がりません。
//    社内のタスク名が公開リポジトリに出ないようにするためです。
//
//  たまったデータから分かること:
//    ・この種類の仕事は見積もりより時間がかかる（見積もり倍率）
//    ・午後はこの仕事の完了率が低い（時間帯別の完了率）
//    ・この仕事は何度も後回しになっている（連続持ち越し）
//    ・この仕事は自分でやらない方がいい（毎回出てくる単純作業）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export const STATE_DIR = path.join(ROOT, 'state', 'secretary');

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function planPath(dateISO) {
  return path.join(STATE_DIR, `${dateISO}.json`);
}

export function loadPlan(dateISO) {
  try {
    return JSON.parse(fs.readFileSync(planPath(dateISO), 'utf8'));
  } catch {
    return null;
  }
}

export function savePlan(plan) {
  ensureDir();
  // 同じ日を組み直したとき、すでに付けた「完了・相手待ち・実績時間」を引き継ぐ。
  // これが無いと、昼にタスクを足して組み直すたびに午前の記録が消える。
  const prev = loadPlan(plan.date);
  if (prev) {
    const before = new Map((prev.tasks ?? []).map((t) => [t.id, t]));
    for (const t of plan.tasks ?? []) {
      const b = before.get(t.id);
      if (!b || b.status === 'planned') continue;
      t.status = b.status;
      t.minutes_actual = b.minutes_actual ?? t.minutes_actual;
      t.waiting_on = b.waiting_on ?? t.waiting_on;
      t.waiting_since = b.waiting_since ?? t.waiting_since;
      t.updated_at = b.updated_at;
    }
  }
  fs.writeFileSync(planPath(plan.date), `${JSON.stringify(plan, null, 1)}\n`, 'utf8');
  return planPath(plan.date);
}

/** 新しい順に過去の記録を読む */
export function listPlans(limit = 60) {
  ensureDir();
  return fs
    .readdirSync(STATE_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')); } catch { return null; }
    })
    .filter(Boolean);
}

/** 直近の記録から「終わらなかった仕事」を拾う（翌朝の持ち越し） */
export function carryOver(dateISO) {
  const prev = listPlans(10).filter((p) => p.date < dateISO)[0];
  if (!prev) return [];
  return (prev.tasks ?? [])
    .filter((t) => t.status !== 'done' && t.status !== 'dropped' && t.status !== 'waiting')
    .map((t) => ({
      title: t.title,
      minutes: t.minutes_planned ?? null,
      carry_count: (t.carry_count ?? 0) + 1,
      carried_from: t.carried_from ?? prev.date,
    }));
}

/**
 * 相手待ちの仕事を集める。
 * 自分の手は離れているので今日の作業時間には数えないが、
 * 「何日待っているか」を毎朝出して、催促の判断だけはできるようにする。
 */
export function waitingItems(dateISO, days = 10) {
  const out = new Map();
  for (const p of listPlans(days)) {
    if (p.date > dateISO) continue;
    for (const t of p.tasks ?? []) {
      if (t.status !== 'waiting') continue;
      const since = t.waiting_since ?? p.date;
      const elapsed = Math.round((Date.parse(`${dateISO}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86400000);
      const prev = out.get(t.id);
      if (!prev || since < prev.since) {
        out.set(t.id, { id: t.id, title: t.title, who: t.waiting_on ?? t.delegate_to ?? null, since, days: Math.max(0, elapsed) });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.days - a.days);
}

/** 完了・未完了を記録する。query はタスク名の一部でもID でも可。 */
export function markStatus(dateISO, query, status, minutesActual, meta = {}) {
  const plan = loadPlan(dateISO);
  if (!plan) return { ok: false, reason: `${dateISO} の予定がまだありません（先に plan を実行してください）` };
  const q = String(query).toLowerCase();
  const hits = (plan.tasks ?? []).filter((t) => t.id === query || t.title.toLowerCase().includes(q));
  if (hits.length === 0) return { ok: false, reason: `「${query}」に一致するタスクがありません` };
  for (const t of hits) {
    t.status = status;
    if (minutesActual != null) t.minutes_actual = Number(minutesActual);
    if (status === 'waiting') {
      t.waiting_on = meta.who ?? t.delegate_to ?? null;
      t.waiting_since = t.waiting_since ?? dateISO;
    }
    t.updated_at = new Date().toISOString();
  }
  savePlan(plan);
  return { ok: true, tasks: hits };
}

function periodOf(slot) {
  const h = Number(String(slot ?? '').slice(0, 2));
  if (!Number.isFinite(h)) return '未定';
  if (h < 12) return '午前';
  if (h < 16) return '午後';
  return '夕方';
}

function rate(done, total) {
  return total ? Math.round((done / total) * 100) : null;
}

/**
 * 蓄積データの分析。
 * @param {number} days さかのぼる日数
 */
export function analyze(days = 30) {
  const plans = listPlans(days);
  const byCategory = new Map();
  const byPeriod = new Map();
  const seen = new Map();          // タスクID → 出現回数・完了回数
  let totalTasks = 0;
  let totalDone = 0;

  for (const p of plans) {
    for (const t of p.tasks ?? []) {
      if (t.deferred || t.status === 'waiting') continue;  // 「今日やらない」「相手待ち」は自分の分母に入れない
      totalTasks += 1;
      const done = t.status === 'done';
      if (done) totalDone += 1;

      const c = byCategory.get(t.category) ?? { category: t.category, total: 0, done: 0, planned: 0, actual: 0, samples: 0 };
      c.total += 1;
      if (done) c.done += 1;
      if (done && t.minutes_actual) {
        c.planned += t.minutes_planned ?? 0;
        c.actual += t.minutes_actual;
        c.samples += 1;
      }
      byCategory.set(t.category, c);

      const key = periodOf(t.slot);
      const pd = byPeriod.get(key) ?? { period: key, total: 0, done: 0 };
      pd.total += 1;
      if (done) pd.done += 1;
      byPeriod.set(key, pd);

      const s = seen.get(t.id) ?? { id: t.id, title: t.title, category: t.category, appears: 0, done: 0, carry: 0, delegate_to: t.delegate_to ?? null };
      s.appears += 1;
      if (done) s.done += 1;
      s.carry = Math.max(s.carry, t.carry_count ?? 0);
      if (!s.delegate_to && t.delegate_to) s.delegate_to = t.delegate_to;
      seen.set(t.id, s);
    }
  }

  const estimate = [...byCategory.values()]
    .map((c) => ({ ...c, completion: rate(c.done, c.total), ratio: c.samples ? Number((c.actual / c.planned).toFixed(2)) : null }))
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

  const periods = ['午前', '午後', '夕方', '未定']
    .map((k) => byPeriod.get(k))
    .filter(Boolean)
    .map((p) => ({ ...p, completion: rate(p.done, p.total) }));

  const chronic = [...seen.values()]
    .filter((s) => s.appears >= 3 && s.done === 0)
    .sort((a, b) => b.appears - a.appears);

  const delegateCandidates = [...seen.values()]
    .filter((s) => s.appears >= 3 && s.delegate_to && ['ADMIN', 'MANAGEMENT', 'IMPROVE'].includes(s.category))
    .sort((a, b) => b.appears - a.appears);

  return {
    days: plans.length,
    from: plans[plans.length - 1]?.date ?? null,
    to: plans[0]?.date ?? null,
    totalTasks,
    totalDone,
    completion: rate(totalDone, totalTasks),
    estimate,
    periods,
    chronic,
    delegateCandidates,
  };
}
