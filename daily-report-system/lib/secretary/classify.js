// ============================================================
//  AI秘書：タスクの中身を読み取る（分類と重みづけ）
// ------------------------------------------------------------
//  1行のタスク文から、次を機械的に決めます。
//    ・カテゴリ（THINK / IMPROVE / DELEGATE / MEETING / MANAGEMENT / ADMIN）
//    ・所要時間の見積もり（書いてあればそれを優先）
//    ・必要な集中力（focus 1〜5）
//    ・売上/利益インパクト・緊急度・他人を止めているか・経営判断度
//  辞書は config/secretary/rules.json にあります。
// ============================================================

/** 辞書の言葉がいくつ当たったかを数える（長い言葉ほど強い＝具体的だから） */
function keywordScore(text, keywords) {
  let score = 0;
  const matched = [];
  for (const kw of keywords ?? []) {
    if (!kw) continue;
    if (text.includes(String(kw).toLowerCase())) {
      score += String(kw).length;
      matched.push(kw);
    }
  }
  return { score, matched };
}

/** 段階つき辞書（{"3":[...], "2":[...]}）から最大レベルを取る */
function levelOf(text, table) {
  let level = 0;
  for (const [lv, words] of Object.entries(table ?? {})) {
    if (keywordScore(text, words).score > 0) level = Math.max(level, Number(lv));
  }
  return level;
}

/** カテゴリ判定。手で #THINK 等が書かれていればそれを尊重する */
export function classify(task, rules) {
  const text = `${task.title ?? ''}`.toLowerCase();
  if (task.category && rules.categories[task.category]) {
    return { category: task.category, matched: ['手動指定'], confident: true };
  }
  // 「〜を依頼」「〜お願い」で終わる文は、中身が制作でも分析でも『人に振る仕事』。
  // ここを取り違えると、10分で終わる依頼が1時間の作業として午前を占領してしまう。
  const title = String(task.title ?? '').replace(/[\s　。、!！]+$/, '');
  if ((rules.delegate_suffix ?? []).some((suf) => title.endsWith(suf))) {
    return { category: 'DELEGATE', matched: ['文末が依頼'], confident: true };
  }
  const scored = Object.entries(rules.categories).map(([name, def]) => {
    const { score, matched } = keywordScore(text, def.keywords);
    return { name, score, matched };
  });
  const best = Math.max(...scored.map((s) => s.score));
  if (best <= 0) return { category: rules.fallback ?? 'MANAGEMENT', matched: [], confident: false };

  const tied = scored.filter((s) => s.score === best);
  const order = rules.tie_break ?? [];
  tied.sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99));
  const win = tied[0];
  // 同点が3カテゴリ以上に割れる＝文が曖昧。人の目で見直したい印をつける。
  return { category: win.name, matched: win.matched, confident: tied.length <= 2 };
}

/** 締切文字列（"09-10" / "today" / "tomorrow"）から緊急度 0〜3 */
function deadlineUrgency(deadline, dateISO) {
  if (!deadline) return 0;
  if (deadline === 'today') return 3;
  if (deadline === 'tomorrow') return 2;
  const iso = `${dateISO.slice(0, 4)}-${deadline}`;
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${dateISO}T00:00:00Z`)) / 86400000);
  if (Number.isNaN(days)) return 0;
  if (days <= 0) return 3;
  if (days <= 2) return 2;
  if (days <= 7) return 1;
  return 0;
}

/** タスク文にメンバー名簿の名前が出てくれば、その人が相手（一番長い一致を採用） */
export function staffInText(text, rules) {
  let hit = null;
  for (const name of rules.staff ?? []) {
    if (text.includes(String(name)) && (!hit || name.length > hit.length)) hit = name;
  }
  return hit;
}

/** 誰に振れそうかを辞書から引く（一番具体的＝長い一致を採用） */
export function delegateTarget(text, rules) {
  let hit = null;
  for (const [kw, who] of Object.entries(rules.delegate_targets ?? {})) {
    if (text.includes(String(kw).toLowerCase()) && (!hit || kw.length > hit.kw.length)) hit = { kw, who };
  }
  return hit ? hit.who : null;
}

/**
 * タスク1件を「判断できる形」にふくらませる。
 * 返り値はもとの task に属性を足したもの（もとの値は壊さない）。
 */
export function enrich(task, rules, profile, dateISO) {
  const text = `${task.title ?? ''} ${task.raw ?? ''}`.toLowerCase();
  const { category, matched, confident } = classify(task, rules);
  const def = rules.categories[category];

  // 所要時間：明記 > 会議の時刻指定から逆算 > カテゴリ標準（言い回しで増減）
  let minutes = task.minutes ?? null;
  if (!minutes && task.fixed?.start && task.fixed?.end) {
    const [sh, sm] = task.fixed.start.split(':').map(Number);
    const [eh, em] = task.fixed.end.split(':').map(Number);
    minutes = (eh * 60 + em) - (sh * 60 + sm);
  }
  if (!minutes) {
    let base = def.default_minutes;
    for (const [word, mul] of Object.entries(rules.minutes_hints ?? {})) {
      if (text.includes(word)) base *= mul;
    }
    minutes = Math.max(5, Math.round(base / 5) * 5);
  }

  const named = task.assignee ?? staffInText(task.title ?? '', rules);
  const impact = levelOf(text, rules.impact);
  const urgency = Math.max(task.urgencyMark ?? 0, levelOf(text, rules.urgency), deadlineUrgency(task.deadline, dateISO));
  const unblocks = category === 'DELEGATE' || Boolean(named) || keywordScore(text, rules.unblock).score > 0;
  const management = Math.min(2, keywordScore(text, rules.management_weight).matched.length);
  const who = delegateTarget(text, rules);

  return {
    ...task,
    category,
    icon: def.icon,
    categoryLabel: def.label,
    focus: def.focus,
    minutes,
    impact,
    urgency,
    unblocks,
    management,
    // 今日やらないと発生する損失（他人が止まる／売上に響く／期限）
    loss: Math.max(urgency, unblocks ? 2 : 0, Math.max(0, impact - 1)),
    quickWin: unblocks && minutes <= (profile?.rules?.quick_delegate_max ?? 10),
    assignee: named,
    delegateTo: named ?? who,
    matched,
    confident,
  };
}

/** まとめて処理する入口 */
export function enrichAll(tasks, rules, profile, dateISO) {
  return tasks.map((t) => enrich(t, rules, profile, dateISO));
}
