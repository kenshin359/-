// ============================================================
//  AI秘書：毎朝の出力（そのまま読める形に整える）
// ------------------------------------------------------------
//  出力の並びは北野マネージャ指定のとおり:
//    🔥 今日絶対終わらせる3つ / 📤 朝一で人に振る仕事 / 🗓 今日のスケジュール
//    📋 タスク仕分け / ⏭ 今日やらなくていい仕事 / ⚠️ 秘書からの指摘
// ============================================================
import { toMin, toHHMM, humanMinutes } from './config.js';

const LINE = '━━━━━━━━━━━━';
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function weekdayOf(dateISO) {
  return WEEK[new Date(`${dateISO}T00:00:00Z`).getUTCDay()];
}

function head(title) {
  return `${LINE}\n${title}\n${LINE}`;
}

function taskLine(t, opts = {}) {
  const bits = [`（${humanMinutes(opts.minutes ?? t.minutes)}）`];
  if (opts.part) bits.push(opts.part);
  if (t.delegateTo && t.category === 'DELEGATE') bits.push(`→ ${t.delegateTo}`);
  return `${t.title}${bits.join('')}`;
}

/** 🗓 今日のスケジュール */
function renderSchedule(plan) {
  const { profile, schedule } = plan;
  const out = [`${profile.rhythm?.wake ?? '05:00'}　起床`];
  const groups = (profile.blocks ?? []).map((b) => ({ b, start: toMin(b.start), end: toMin(b.end), entries: [] }));
  const outside = [];

  for (const e of schedule.timeline) {
    const g = groups.find((x) => e.start >= x.start && e.start < x.end) ?? groups.find((x) => e.start < x.end && e.end > x.start);
    if (g) g.entries.push(e);
    else outside.push(e);
  }

  for (const g of groups) {
    const entries = g.entries.filter((e) => e.kind !== 'fixed').sort((a, b) => a.start - b.start);
    const icons = [...new Set(entries.filter((e) => e.kind === 'task').map((e) => e.task.icon))].join('');
    if (g.b.fixed || entries.length === 0) {
      out.push('', `${g.b.start}〜${g.b.end}`, `　${g.b.label}`);
      continue;
    }
    out.push('', `${g.b.start}〜${g.b.end}`, `${icons} ${g.b.label}`);
    for (const e of entries) {
      const time = `${toHHMM(e.start)}〜${toHHMM(e.end)}`;
      if (e.kind === 'break') { out.push(`　${time}　☕ ${e.label}`); continue; }
      if (e.kind === 'free') { out.push(`　${time}　${e.label}`); continue; }
      const mins = e.minutes ?? e.end - e.start;
      const part = e.partCount
        ? `［${e.partIndex}/${e.partCount}］`
        : (mins < e.task.minutes ? `［前半のみ・残り${humanMinutes(e.task.minutes - mins)}は明日］` : '');
      const flag = plan.mustDo.some((m) => m.id === e.task.id) ? '🔥 ' : '';
      const pin = e.pinned ? '📌 ' : '';
      out.push(`　${time}　${flag}${pin}${e.task.icon} ${taskLine(e.task, { part, minutes: mins })}`);
    }
  }

  for (const e of outside.sort((a, b) => a.start - b.start)) {
    if (e.kind !== 'task') continue;
    out.push('', `${toHHMM(e.start)}〜${toHHMM(e.end)}`, `　📌 ${e.task.icon} ${taskLine(e.task)}（時間割の枠外の予定）`);
  }
  return out.join('\n');
}

/** 📋 タスク仕分け */
function renderBuckets(plan) {
  const lines = [];
  for (const [name, def] of Object.entries(plan.categories)) {
    const items = plan.today.filter((t) => t.category === name);
    lines.push('', `${def.icon} ${name}｜${def.label}`);
    if (items.length === 0) lines.push('・（なし）');
    for (const t of items) lines.push(`・${t.title}（${humanMinutes(t.minutes)}）${t.slot ? ` ${t.slot}` : ''}`);
  }
  return lines.join('\n').trim();
}

/** 全体の組み立て */
export function formatPlan(plan) {
  const parts = [];
  parts.push(
    `📅 ${plan.date}（${weekdayOf(plan.date)}）　AI秘書 1日最適化`,
    `タスク${plan.tasksCount}件 ／ 見積合計 ${humanMinutes(plan.totalMinutes)} ／ 今日つかえる時間 ${humanMinutes(plan.capacity)}`
  );

  parts.push('', head('🔥 今日絶対終わらせる3つ'));
  if (plan.mustDo.length === 0) parts.push('（該当なし）');
  plan.mustDo.forEach((t, i) => {
    parts.push(`${i + 1}. ${t.icon} ${t.title}${t.slot ? `（${t.slot}）` : ''}`);
    parts.push(`　→ ${t.why}`);
  });

  parts.push('', head('📤 朝一で人に振る仕事'));
  if (plan.morningDelegate.length === 0) parts.push('（今日は他人待ちを作っている仕事はありません）');
  for (const t of plan.morningDelegate) {
    parts.push(`・${t.title}`);
    parts.push(`　→ ${t.delegateTo ?? '担当者を決める'} に依頼（${t.assignee ? '指名あり' : '推奨'}）`);
    parts.push(`　→ 目安 ${humanMinutes(t.minutes)}${t.slot ? ` ／ ${t.slot}` : ''}`);
  }

  if ((plan.waiting ?? []).length) {
    parts.push('', head('⏳ 相手待ち（自分の作業ではない・催促の要否だけ判断）'));
    for (const w of plan.waiting) {
      parts.push(`・${w.title}`);
      parts.push(`　→ ${w.who ?? '相手'}待ち ／ ${w.days === 0 ? '本日から' : `${w.days}日経過`}（${w.since}〜）`);
    }
  }

  parts.push('', head('🗓 今日のスケジュール'), renderSchedule(plan));

  parts.push('', head('📋 タスク仕分け'), renderBuckets(plan));

  parts.push('', head('⏭ 今日やらなくていい仕事'));
  if (plan.deferred.length === 0) parts.push('（今日のタスクはすべて今日の枠に収まります）');
  for (const t of plan.deferred) {
    parts.push(`・${t.icon} ${t.title}（${humanMinutes(t.minutes)}）`);
    parts.push(`　→ ${t.deferReason}`);
    parts.push(`　→ 推奨：翌営業日の ${t.recommend}`);
  }

  parts.push('', head('⚠️ 秘書からの指摘'));
  if (plan.advice.length === 0) parts.push('・今日の組み方に大きな無理はありません。予定どおり進めてください。');
  for (const a of plan.advice) parts.push(`・${a}`);

  return parts.join('\n');
}

/** 蓄積データの分析レポート */
export function formatReview(stats) {
  const out = [head('📈 AI秘書 ふりかえり分析')];
  if (!stats.days) return `${out.join('\n')}\nまだ記録がありません。まずは毎朝 plan を実行してください。`;
  out.push(`対象：${stats.from} 〜 ${stats.to}（${stats.days}日）`);
  out.push(`タスク ${stats.totalTasks}件 ／ 完了 ${stats.totalDone}件（完了率 ${stats.completion ?? '-'}%）`);

  out.push('', '■ 見積もりのクセ（実績÷見積）');
  if (stats.estimate.every((c) => c.ratio == null)) out.push('・実績の記録がまだありません（`done` で所要時間を記録すると出ます）');
  for (const c of stats.estimate) {
    const ratio = c.ratio ? `${c.ratio}倍` : '実績未記録';
    out.push(`・${c.category}：${ratio}（完了率 ${c.completion ?? '-'}% ／ ${c.total}件）`);
    if (c.ratio && c.ratio >= 1.3) out.push(`　→ ${c.category} は見積もりの${c.ratio}倍かかっています。最初から${Math.round((c.ratio - 1) * 100)}%多く見てください。`);
  }

  out.push('', '■ 時間帯ごとの完了率');
  for (const p of stats.periods) out.push(`・${p.period}：${p.completion ?? '-'}%（${p.done}/${p.total}件）`);
  const worst = stats.periods.filter((p) => p.period !== '未定').sort((a, b) => (a.completion ?? 100) - (b.completion ?? 100))[0];
  if (worst && worst.completion != null && worst.completion < 60) {
    out.push(`　→ ${worst.period}の完了率が${worst.completion}%。${worst.period}に重い仕事を置きすぎています。`);
  }

  out.push('', '■ 何度も後回しになっている仕事');
  if (stats.chronic.length === 0) out.push('・なし（先送りはできていません。良い状態です）');
  for (const c of stats.chronic) out.push(`・${c.title}（${c.appears}日連続で未完了）→ 今日やる／やめる／渡す のどれかを決めてください`);

  out.push('', '■ 人に任せた方がいい仕事');
  if (stats.delegateCandidates.length === 0) out.push('・現時点では特になし');
  for (const d of stats.delegateCandidates) out.push(`・${d.title}（${d.appears}回登場）→ ${d.delegate_to} に定型で渡す`);

  return out.join('\n');
}
