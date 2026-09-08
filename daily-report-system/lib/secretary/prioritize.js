// ============================================================
//  AI秘書：優先順位づけ（何を今日やり、何を捨てるか）
// ------------------------------------------------------------
//  並べ替えの根拠（北野マネージャ指定の観点）:
//    ・売上/利益への影響   impact
//    ・緊急性             urgency
//    ・他スタッフを止めていないか unblocks（最重要のひとつ）
//    ・今日やらない損失     loss
//    ・経営判断としての重要度 management
//    ・所要時間            minutes（長いほど少し不利＝重い仕事は数を絞る）
//    ・持ち越し回数        carryCount（腐らせないため日に日に上がる）
// ============================================================

/** 優先度スコア。重みは config/secretary/profile.json の weights で調整できます。 */
export function scoreTask(t, weights) {
  const w = weights ?? {};
  return (
    (w.impact ?? 3) * (t.impact ?? 0) +
    (w.urgency ?? 2.5) * (t.urgency ?? 0) +
    (w.unblock ?? 3) * (t.unblocks ? 1 : 0) +
    (w.loss ?? 2) * (t.loss ?? 0) +
    (w.management ?? 1.5) * (t.management ?? 0) +
    (w.quick_win ?? 1.5) * (t.quickWin ? 1 : 0) +
    (w.category_bias?.[t.category] ?? 0) +
    (w.carry ?? 0.8) * Math.min(5, t.carryCount ?? 0) -
    (w.effort ?? 0.6) * ((t.minutes ?? 30) / 60)
  );
}

/**
 * 「なぜ今日やるのか」を一言で。スコアの内訳から一番効いた理由を選ぶ。
 * used に既出の理由を渡すと、同じ文言の繰り返しを避けて次点を出します。
 */
export function whyToday(t, used = new Set()) {
  const reasons = [];
  if (t.carryCount >= 2) reasons.push([9 + t.carryCount, `${t.carryCount}日連続で持ち越し中。今日決着させないと永久に動かない`]);
  if (t.unblocks) reasons.push([8, `他のスタッフがこれ待ちで止まっている（渡せば並行で進む）`]);
  if (t.urgency >= 3) reasons.push([7.5, `今日が期限。遅れるとそのまま損失になる`]);
  if (t.impact >= 3) reasons.push([7, `売上・利益に直結する（先延ばしの1日がそのまま機会損失）`]);
  if (t.management >= 1) reasons.push([6, `経営判断が必要で、他の人では代われない`]);
  if (t.urgency === 2) reasons.push([5, `期限が近い（今週中）`]);
  if (t.impact === 2) reasons.push([4.5, `コスト・納期に効く`]);
  if (t.focus >= 4) reasons.push([3, `集中力が要る仕事なので、頭が動く今日の午前に置くのが最も安い`]);
  reasons.sort((a, b) => b[0] - a[0]);
  const fresh = reasons.find((r) => !used.has(r[1]));
  return (fresh ?? reasons[0])?.[1] ?? '優先度スコアが最も高い';
}

/** 後回しにしてよい理由 */
function whyNotToday(t, overCapacity) {
  if (t.urgency <= 1 && !t.unblocks && t.impact <= 1) return '緊急でも売上直結でもなく、誰の仕事も止めていない';
  if (overCapacity) return '今日の作業可能時間を超えるため（優先度がこの下）';
  if (t.urgency <= 1) return '期限に余裕がある';
  return '今日の枠に収まらない';
}

/** そのカテゴリを最初に受け入れる時間帯（＝おすすめ実施時間）を profile から引く */
export function recommendedSlot(category, profile) {
  const b = (profile.blocks ?? []).find((x) => !x.fixed && (x.accept ?? []).includes(category));
  return b ? `${b.start}〜${b.end}` : '午前';
}

/**
 * 今日やる／やらないを決める。
 * @param {object[]} tasks enrich 済みタスク
 * @param {object} profile
 * @param {number} capacity 今日の作業可能分数（休憩・固定枠を除く）
 */
export function prioritize(tasks, profile, capacity) {
  const rules = profile.rules ?? {};
  const scored = tasks
    .map((t) => ({ ...t, score: Number(scoreTask(t, profile.weights).toFixed(2)) }))
    .sort((a, b) => b.score - a.score || (a.minutes ?? 0) - (b.minutes ?? 0));

  const usable = Math.floor(capacity * (1 - (rules.capacity_buffer ?? 0.15)));
  const today = [];
  const deferred = [];
  let used = 0;

  // ① 時間が決まっている予定（会議など）は動かせないので先に確保する
  for (const t of scored.filter((x) => x.fixed?.start)) {
    today.push(t);
    used += t.minutes;
  }
  // ② 残りをスコア順に詰める
  for (const t of scored.filter((x) => !x.fixed?.start)) {
    const over = used + t.minutes > usable;
    // 「他人を止めている5〜10分の依頼」は容量に関係なく必ず今日出す（全体の進みが変わるため）
    if (!over || t.quickWin) {
      today.push(t);
      used += t.minutes;
    } else {
      deferred.push({ ...t, deferReason: whyNotToday(t, true), recommend: recommendedSlot(t.category, profile) });
    }
  }
  today.sort((a, b) => b.score - a.score);

  // ③ 今日絶対終わらせる3つ
  //    ・時間が決まっている会議・確認・事務は「予定」であって「やり切る仕事」ではないので外す
  //      （時間指定でも THINK / IMPROVE は成果を作る仕事なので残す）
  //    ・5〜10分の依頼は下の「朝一で人に振る仕事」で必ず片づくので、ここは実務で埋める
  const pool = today.filter((t) => !(t.fixed?.start && ['MEETING', 'MANAGEMENT', 'ADMIN'].includes(t.category)));
  const primary = pool.filter((t) => (t.category !== 'ADMIN' || t.urgency >= 3) && !t.quickWin);
  const usedReasons = new Set();
  const mustDo = (primary.length >= (rules.must_do_count ?? 3) ? primary : pool)
    .slice(0, rules.must_do_count ?? 3)
    .map((t) => {
      const why = whyToday(t, usedReasons);
      usedReasons.add(why);
      return { ...t, why };
    });

  // ④ 朝一で人に振る仕事（他人の着手待ちを最初に解く）
  const morningDelegate = today
    .filter((t) => t.unblocks && !t.fixed?.start && t.category !== 'MEETING'
      && t.minutes <= Math.max(20, (rules.quick_delegate_max ?? 10) * 2))
    .sort((a, b) => (a.minutes - b.minutes) || (b.score - a.score));

  // ⑤ 本来は自分でやらなくてよい仕事（秘書からの指摘に使う）
  const delegateSuggestions = today.filter(
    (t) => t.category !== 'DELEGATE' && t.delegateTo && t.minutes >= 20 && t.focus <= 4 && t.management === 0 &&
      (t.category === 'ADMIN' || t.category === 'MANAGEMENT' || (t.category === 'IMPROVE' && t.impact <= 2))
  );

  return { today, deferred, mustDo, morningDelegate, delegateSuggestions, capacity: usable, planned: used };
}
