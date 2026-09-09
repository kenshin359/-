// ============================================================
//  AI秘書：1日の時間割を組む
// ------------------------------------------------------------
//  「重要度順に並べる」だけでは終わりません。
//  ・集中力の高い午前に THINK / IMPROVE を置く
//  ・15時以降に THINK を置かない（判断が要る仕事も16時で打ち切り）
//  ・他人待ちを解く依頼は朝一の枠へ
//  ・会議が続くときは間に休憩を差し込む
//  ・昼食・昼寝・15時前の休憩は固定枠として絶対に潰さない
//  枠の定義は config/secretary/profile.json の blocks です。
// ============================================================
import { toMin, toHHMM } from './config.js';

/** 今日つかえる作業時間の合計（固定枠＝食事・休憩・整理は除く） */
export function workCapacity(profile) {
  return (profile.blocks ?? [])
    .filter((b) => !b.fixed)
    .reduce((s, b) => s + (toMin(b.end) - toMin(b.start)), 0);
}

function makeBlocks(profile) {
  return (profile.blocks ?? []).map((b) => ({
    id: b.id,
    label: b.label,
    start: toMin(b.start),
    end: toMin(b.end),
    energy: b.energy ?? 0,
    accept: b.accept ?? [],
    fixed: Boolean(b.fixed),
    gaps: b.fixed ? [] : [{ start: toMin(b.start), end: toMin(b.end), cursor: toMin(b.start), items: [] }],
  }));
}

/** 予定が入っている時間を空き枠から差し引く */
function carveOut(block, from, to) {
  const next = [];
  for (const g of block.gaps) {
    if (to <= g.start || from >= g.end) { next.push(g); continue; }
    if (from > g.start) next.push({ start: g.start, end: Math.min(from, g.end), cursor: g.start, items: [] });
    if (to < g.end) next.push({ start: Math.max(to, g.start), end: g.end, cursor: Math.max(to, g.start), items: [] });
  }
  block.gaps = next;
}

/** そのカテゴリをその時刻に置いてよいか（15時以降のTHINK禁止など） */
function allowedAt(task, startMin, profile) {
  const r = profile.rules ?? {};
  if (task.category === 'THINK' && startMin >= toMin(r.think_cutoff ?? '15:00')) return false;
  if ((task.focus ?? 0) >= (r.judgement_focus ?? 4) && startMin >= toMin(r.judgement_cutoff ?? '16:00')) return false;
  return true;
}

/**
 * 時間割を作る。
 * @param {object[]} tasks 優先順位づけ済み（score降順）のタスク
 * @returns {{timeline:object[], unplaced:object[], notes:string[]}}
 */
export function buildSchedule(tasks, profile, optional = []) {
  const r = profile.rules ?? {};
  const blocks = makeBlocks(profile);
  const notes = [];
  const pinned = [];

  // ① 時間が決まっている予定を先に固定する
  for (const t of tasks.filter((x) => x.fixed?.start)) {
    const start = toMin(t.fixed.start);
    const end = t.fixed.end ? toMin(t.fixed.end) : start + t.minutes;
    pinned.push({ kind: 'task', start, end, task: t, pinned: true });
    for (const b of blocks) carveOut(b, start, end);
    if (t.category === 'MEETING' && end - start > (r.meeting_max_run ?? 50)) {
      notes.push(`「${t.title}」は${end - start}分の予定。${r.meeting_max_run ?? 50}分で区切り、議題を事前共有すると疲れ方が変わります。`);
    }
  }

  // ② 残りをスコア順に、置ける一番早い枠へ
  //    1周目：そのカテゴリ専用の枠に、まるごと入るものだけ
  //    2周目：受け入れ可能な他の枠に、まるごと入るものだけ
  //    3周目：どうしても入らない長い仕事だけ、前半・後半に割る
  //    こうしないと、IMPROVE が午前の THINK 枠を先に食い尽くし、
  //    さらに「入る場所があるのに細切れ」という最悪の組み方になります。
  //    並べる順番: 優先度が「ほぼ同じ」グループの中では、長い仕事を先に置く。
  //    そうしないと 60分の仕事が 120分枠を先に取り、90分の仕事が細切れになります。
  const tier = (t) => Math.floor((t.score ?? 0) / (r.tier_size ?? 1.5));
  const rest = tasks
    .filter((x) => !x.fixed?.start)
    .map((t) => ({ t, remaining: t.minutes, parts: 0 }))
    .sort((a, b) => tier(b.t) - tier(a.t) || b.t.minutes - a.t.minutes);
  for (const pass of [1, 2, 3]) {
    for (const item of rest) {
      const t = item.t;
      if (item.remaining <= 0) continue;
      for (const b of blocks) {
        if (item.remaining <= 0) break;
        if (b.fixed || !b.accept.includes(t.category)) continue;
        if (pass === 1 && b.accept[0] !== t.category) continue;
        const allowSplit = pass === 3;
        for (const g of b.gaps) {
          if (item.remaining <= 0) break;
          const last = g.items[g.items.length - 1];
          const brk = t.category === 'MEETING' && last?.task?.category === 'MEETING' ? (r.meeting_break ?? 10) : 0;
          const startAt = g.cursor + brk;
          if (!allowedAt(t, startAt, profile)) continue;
          const free = g.end - startAt;
          if (free <= 0) continue;
          if (free >= item.remaining) {
            g.items.push({ task: t, minutes: item.remaining, breakBefore: brk, block: b });
            g.cursor = startAt + item.remaining;
            item.remaining = 0;
            item.parts += 1;
          } else if (allowSplit && free >= (r.split_min_chunk ?? 30) && t.minutes >= (r.split_min_chunk ?? 30) * 2) {
            // 長い仕事は前半・後半に割って、午前の良い時間から使い切る
            g.items.push({ task: t, minutes: free, breakBefore: brk, block: b, split: true });
            g.cursor = g.end;
            item.remaining -= free;
            item.parts += 1;
          }
        }
      }
    }
  }
  const unplaced = rest
    .filter((x) => x.remaining > 0)
    .map((x) => (x.parts === 0 ? x.t : { ...x.t, minutes: x.remaining, partial: true }));

  // ②-2 救済パス:
  //   「時間が足りない」と判断して今日から外したタスクでも、
  //   そのカテゴリの枠がまだ空いていれば拾い直す。
  //   （ADMIN枠が90分空いているのに15分の事務を明日に回す、という事故を防ぐ）
  const rescued = [];
  for (const t of optional) {
    let done = false;
    for (const b of blocks) {
      if (done || b.fixed || !b.accept.includes(t.category)) continue;
      for (const g of b.gaps) {
        if (done) break;
        const last = g.items[g.items.length - 1];
        const brk = t.category === 'MEETING' && last?.task?.category === 'MEETING' ? (r.meeting_break ?? 10) : 0;
        const startAt = g.cursor + brk;
        if (!allowedAt(t, startAt, profile)) continue;
        if (g.end - startAt >= t.minutes) {
          g.items.push({ task: t, minutes: t.minutes, breakBefore: brk, block: b });
          g.cursor = startAt + t.minutes;
          rescued.push(t.id);
          done = true;
        }
      }
    }
  }

  // ③ 実際の時刻に展開する（分割された仕事には［1/2］の印をつける）
  const partCount = new Map();
  for (const b of blocks) for (const g of b.gaps) for (const it of g.items) {
    partCount.set(it.task.id, (partCount.get(it.task.id) ?? 0) + 1);
  }
  const partSeen = new Map();
  const timeline = [...pinned];
  for (const b of blocks) {
    if (b.fixed) {
      timeline.push({ kind: 'fixed', start: b.start, end: b.end, label: b.label, block: b });
      continue;
    }
    let placed = 0;
    for (const g of b.gaps) {
      let cursor = g.start;
      for (const it of g.items) {
        if (it.breakBefore) {
          timeline.push({ kind: 'break', start: cursor, end: cursor + it.breakBefore, label: '休憩（会議の間）', block: b });
          cursor += it.breakBefore;
        }
        const total = partCount.get(it.task.id) ?? 1;
        const idx = (partSeen.get(it.task.id) ?? 0) + 1;
        partSeen.set(it.task.id, idx);
        timeline.push({
          kind: 'task', start: cursor, end: cursor + it.minutes, task: it.task, block: b,
          minutes: it.minutes, partIndex: total > 1 ? idx : null, partCount: total > 1 ? total : null,
        });
        cursor += it.minutes;
        placed += it.minutes;
      }
      if (g.end - cursor >= 15) timeline.push({ kind: 'free', start: cursor, end: g.end, label: '空き（予備・前倒し用）', block: b });
    }
    if (placed === 0 && b.gaps.length === 0) notes.push(`${b.label}は予定で埋まりました。`);
  }

  timeline.sort((a, b) => a.start - b.start || a.end - b.end);

  // ④ 連続する会議の総量チェック（疲労の予防）
  const meetings = timeline.filter((e) => e.kind === 'task' && e.task.category === 'MEETING');
  const meetingMinutes = meetings.reduce((s, e) => s + (e.end - e.start), 0);
  if (meetings.length >= (r.meeting_alert_count ?? 4) || meetingMinutes >= (r.meeting_alert_minutes ?? 180)) {
    notes.push(`本日の会議は${meetings.length}件・合計${meetingMinutes}分。午後が会議で埋まると翌朝まで響きます。1〜2件は代理出席か議事録共有に置き換えてください。`);
  }

  return { timeline, unplaced, notes, rescued, meetingMinutes, meetingCount: meetings.length };
}

/** 時刻つきの1行に整える（フォーマッタから使う） */
export function slotLabel(entry) {
  return `${toHHMM(entry.start)}〜${toHHMM(entry.end)}`;
}
