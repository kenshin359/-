// ============================================================
//  AI秘書：入口（貼り付けたタスク一覧 → 1日の最適解）
// ------------------------------------------------------------
//  流れ:
//    ①読む(parse) → ②中身を判定(classify) → ③優先順位(prioritize)
//    → ④時間割(schedule) → ⑤指摘を作る → ⑥出力(format)
//  ⑤の「指摘」は、遠慮せずに書くのが仕事です（全部を重要と言わない）。
// ============================================================
import { parseTasks, parseLine } from './parse.js';
import { enrichAll } from './classify.js';
import { prioritize } from './prioritize.js';
import { buildSchedule, workCapacity } from './schedule.js';
import { loadProfile, loadRules, toHHMM, humanMinutes } from './config.js';

/** 前日から持ち越したタスクを今朝の一覧に足す */
function mergeCarryOver(tasks, carry) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const c of carry ?? []) {
    const parsed = parseLine(c.title);
    if (!parsed) continue;
    const exist = byId.get(parsed.id);
    if (exist) {
      exist.carryCount = Math.max(exist.carryCount ?? 0, c.carry_count ?? 1);
      exist.carriedFrom = c.carried_from ?? null;
      continue;
    }
    const t = { ...parsed, minutes: parsed.minutes ?? c.minutes ?? null, carryCount: c.carry_count ?? 1, carriedFrom: c.carried_from ?? null };
    tasks.push(t);
    byId.set(t.id, t);
  }
  return tasks;
}

/** ⚠️ 秘書からの指摘 */
function buildAdvice(ctx) {
  const { today, deferred, delegateSuggestions, schedule, capacity, totalMinutes, profile, stats, tasksCount, waiting } = ctx;
  const out = [];
  const r = profile.rules ?? {};

  if (totalMinutes > capacity) {
    out.push(
      `タスク${tasksCount}件・見積合計${humanMinutes(totalMinutes)}に対し、今日つかえるのは${humanMinutes(capacity)}です。` +
      `${deferred.length}件を明日以降に回しました。全部を今日やろうとすると、全部が中途半端になります。`
    );
  }
  if (tasksCount >= 12) {
    out.push(`1日に${tasksCount}件は多すぎます。「今日絶対終わらせる3つ」以外は、終わらなくても問題ない前提で進めてください。`);
  }

  for (const n of schedule.notes) out.push(n);

  for (const t of delegateSuggestions) {
    out.push(`「${t.title}」（${humanMinutes(t.minutes)}）は自分でやらなくてよい仕事です。${t.delegateTo}に渡してください。あなたの時間の${Math.round((t.minutes / capacity) * 100)}%を使っています。`);
  }

  for (const t of schedule.unplaced) {
    out.push(t.partial
      ? `「${t.title}」は前半しか入りませんでした（残り${humanMinutes(t.minutes)}）。今日は前半だけ進めて、残りは明日の午前に置いてください。`
      : `「${t.title}」（${humanMinutes(t.minutes)}）は今日の枠に入りませんでした。明日の午前に回すか、30分に切って前倒ししてください。`);
  }

  for (const t of today.filter((x) => (x.carryCount ?? 0) >= (r.carry_alert_count ?? 3))) {
    out.push(`「${t.title}」は${t.carryCount}日連続で持ち越しています。やる・やめる・渡す の3択で、今日中に決着させてください。`);
  }

  for (const t of today.filter((x) => !x.confident)) {
    out.push(`「${t.title}」は分類が曖昧なため ${t.category} として置きました。違う場合は行末に #THINK のように書いてください。`);
  }

  for (const w of waiting ?? []) {
    if (w.days >= 3) out.push(`「${w.title}」は${w.who ?? '相手'}待ちのまま${w.days}日経過しています。今日催促するか、待たずに進める方法に切り替えてください。`);
  }

  if (today.length > 0 && !today.some((t) => t.category === 'THINK')) {
    out.push('今日はTHINK（リサーチ・分析・戦略）がゼロです。最も集中力が高い午前が、管理と事務で埋まっています。週2回は午前を思考に空けてください。');
  }
  const thinkMinutes = today.filter((t) => t.category === 'THINK').reduce((s, t) => s + t.minutes, 0);
  if (thinkMinutes > 0 && thinkMinutes < 60 && today.length >= 6) {
    out.push(`THINKが${humanMinutes(thinkMinutes)}しかありません。売上を伸ばす仕事は全部ここから生まれます。明日は最低60分確保してください。`);
  }

  // 蓄積データからの指摘（記録がたまるほど鋭くなります）
  for (const c of stats?.estimate ?? []) {
    if (c.ratio && c.ratio >= 1.3 && today.some((t) => t.category === c.category)) {
      out.push(`過去の実績では ${c.category} は見積もりの${c.ratio}倍かかっています。今日の${c.category}も、その前提で予定を詰めすぎないでください。`);
    }
  }
  const worst = (stats?.periods ?? []).filter((p) => p.period !== '未定' && p.completion != null).sort((a, b) => a.completion - b.completion)[0];
  if (worst && worst.completion < 60 && worst.total >= 5) {
    out.push(`過去${stats.days}日で${worst.period}の完了率は${worst.completion}%です。${worst.period}に置いた仕事は落ちやすいので、重要なものは前倒ししてください。`);
  }
  for (const c of stats?.chronic ?? []) {
    if (today.some((t) => t.id === c.id)) out.push(`「${c.title}」は${c.appears}日ぶん記録に出続けて、一度も完了していません。今日やらないなら、正式に「やらない」と決めてください。`);
  }

  return [...new Set(out)];
}

/**
 * 毎朝の本体。
 * @param {string} text 貼り付けたタスク一覧
 * @param {object} opt {date, profile, rules, carry, stats}
 */
export function buildDailyPlan(text, opt = {}) {
  const date = opt.date ?? new Date().toISOString().slice(0, 10);
  const profile = opt.profile ?? loadProfile();
  const rules = opt.rules ?? loadRules();

  const parsed = mergeCarryOver(parseTasks(text), opt.carry);
  const tasks = enrichAll(parsed, rules, profile, date);
  const capacity = workCapacity(profile);
  const p = prioritize(tasks, profile, capacity);
  const schedule = buildSchedule(p.today, profile);

  // 各タスクに実際の時間帯を書き戻す（出力とデータ保存の両方で使う）
  const slots = new Map();
  for (const e of schedule.timeline) {
    if (e.kind !== 'task') continue;
    const list = slots.get(e.task.id) ?? [];
    list.push(`${toHHMM(e.start)}〜${toHHMM(e.end)}`);
    slots.set(e.task.id, list);
  }
  const setSlot = (t) => ({ ...t, slot: (slots.get(t.id) ?? []).join(' ＋ ') || null });
  const today = p.today.map(setSlot);
  const mustDo = p.mustDo.map(setSlot);
  const morningDelegate = p.morningDelegate.map(setSlot);

  const totalMinutes = tasks.reduce((s, t) => s + t.minutes, 0);
  const advice = buildAdvice({
    today, deferred: p.deferred, delegateSuggestions: p.delegateSuggestions, schedule,
    capacity: p.capacity, totalMinutes, profile, stats: opt.stats, tasksCount: tasks.length,
    waiting: opt.waiting ?? [],
  });

  return {
    date,
    profile,
    categories: rules.categories,
    tasksCount: tasks.length,
    totalMinutes,
    capacity: p.capacity,
    plannedMinutes: p.planned,
    today,
    mustDo,
    morningDelegate,
    deferred: p.deferred,
    delegateSuggestions: p.delegateSuggestions,
    schedule,
    waiting: opt.waiting ?? [],
    advice,
  };
}

/**
 * Excel などの帳票を作るための形へ。
 * 画面用の整形（format.js）と違い、意味だけを渡します。
 */
export function toSheetJson(plan) {
  const t = (x) => ({
    title: x.title, icon: x.icon, category: x.category, minutes: x.minutes,
    slot: x.slot ?? null, who: x.delegateTo ?? null, named: Boolean(x.assignee),
    score: x.score ?? null, must: plan.mustDo.some((m) => m.id === x.id),
  });
  return {
    date: plan.date,
    tasks_count: plan.tasksCount,
    total_minutes: plan.totalMinutes,
    capacity: plan.capacity,
    planned_minutes: plan.plannedMinutes,
    must_do: plan.mustDo.map((x) => ({ ...t(x), why: x.why })),
    morning_delegate: plan.morningDelegate.map(t),
    timeline: plan.schedule.timeline.map((e) => ({
      start: toHHMM(e.start), end: toHHMM(e.end), kind: e.kind,
      label: e.label ?? null, minutes: (e.minutes ?? e.end - e.start),
      block: e.block?.label ?? null, pinned: Boolean(e.pinned),
      part: e.partCount ? `${e.partIndex}/${e.partCount}` : null,
      ...(e.kind === 'task' ? t(e.task) : {}),
    })),
    buckets: Object.fromEntries(
      Object.entries(plan.categories).map(([name, def]) => [
        name, { icon: def.icon, label: def.label, items: plan.today.filter((x) => x.category === name).map(t) },
      ])
    ),
    waiting: plan.waiting ?? [],
    deferred: plan.deferred.map((x) => ({ ...t(x), reason: x.deferReason, recommend: x.recommend })),
    advice: plan.advice,
  };
}

/** 保存用（state/secretary/YYYY-MM-DD.json）に落とす形へ */
export function toRecord(plan) {
  const row = (t, deferred) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    priority: t.score,
    focus: t.focus,
    minutes_planned: t.minutes,
    minutes_actual: null,
    slot: t.slot ?? null,
    status: deferred ? 'deferred' : 'planned',
    deferred: Boolean(deferred),
    delegate_to: t.delegateTo ?? null,
    carry_count: t.carryCount ?? 0,
    carried_from: t.carriedFrom ?? null,
    must_do: plan.mustDo.some((m) => m.id === t.id),
  });
  return {
    date: plan.date,
    created_at: new Date().toISOString(),
    capacity: plan.capacity,
    planned_minutes: plan.plannedMinutes,
    total_minutes: plan.totalMinutes,
    must_do: plan.mustDo.map((t) => t.id),
    tasks: [...plan.today.map((t) => row(t, false)), ...plan.deferred.map((t) => row(t, true))],
  };
}
