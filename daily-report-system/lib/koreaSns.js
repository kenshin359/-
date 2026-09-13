// ============================================================
//  韓国SNS運用管理：判定と集計（計算だけ／通信なし）
// ------------------------------------------------------------
//  kintoneアプリ「韓国SNS運用管理（明洞）」のレコードを読んで、
//    ・いま誰が何をしている案件なのか（進捗）
//    ・報告が遅れている／抜けているのはどれか（アラート）
//    ・撮影 → 投稿 → 広告 → 流入 → 予約 がいくつ繋がったか（集計）
//  を出します。
//
//  ★考え方
//    「報告がない」を人が気づくのではなく、
//    「欄が埋まっていない」をシステムが毎週指摘する形にしています。
//    月末にまとめて気づくのでは遅いので、都度＋週次で出します。
//
//  通信はしません（テストしやすいように計算だけを置いています）。
//  kintoneからの取得は scripts/koreaSnsReport.js 側の仕事です。
// ============================================================

/** kintoneレコードの値を素直なJSにする（値が無ければ null / 0 / []） */
function text(record, code) {
  const v = record?.[code]?.value;
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function number(record, code) {
  const v = record?.[code]?.value;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function list(record, code) {
  const v = record?.[code]?.value;
  return Array.isArray(v) ? v.map(String) : [];
}

/**
 * kintoneのレコード1件を、扱いやすい形に直す。
 * @param {object} record kintone形式 { code: { value } }
 */
export function normalizeRecord(record) {
  const rows = Array.isArray(record?.posts?.value) ? record.posts.value : [];
  const posts = rows.map((row) => {
    const v = row?.value ?? {};
    return {
      postDate: text(v, 'p_post_date'),
      media: text(v, 'p_media'),
      format: text(v, 'p_format'),
      type: text(v, 'p_type'),
      url: text(v, 'p_url'),
      ad: text(v, 'p_ad') === 'あり',
      adCost: number(v, 'p_ad_cost') ?? 0,
      views: number(v, 'p_views') ?? 0,
      likes: number(v, 'p_likes') ?? 0,
      saves: number(v, 'p_saves') ?? 0,
      profile: number(v, 'p_profile') ?? 0,
      clicks: number(v, 'p_clicks') ?? 0,
      note: text(v, 'p_note'),
    };
  });

  return {
    id: text(record, '$id'),
    title: text(record, 'title') ?? '(案件名なし)',
    status: text(record, 'status'),
    owner: text(record, 'owner'),
    editor: text(record, 'editor'),
    goal: text(record, 'goal'),

    sharedAt: text(record, 'shared_at'),
    shootDate: text(record, 'shoot_date'),
    shootTime: text(record, 'shoot_time'),
    place: text(record, 'place'),
    content: text(record, 'content'),
    cast: text(record, 'cast'),
    castFollower: number(record, 'cast_follower'),
    planCount: number(record, 'plan_count'),
    planMedia: list(record, 'plan_media'),
    planPostDate: text(record, 'plan_post_date'),
    planAd: text(record, 'plan_ad'),

    shotCount: number(record, 'shot_count'),
    editCount: number(record, 'edit_count'),
    editDue: text(record, 'edit_due'),
    editDone: text(record, 'edit_done'),

    posts,

    inflow: number(record, 'inflow'),
    reserve: number(record, 'reserve'),
    visit: number(record, 'visit'),
    sales: number(record, 'sales'),
    resultNote: text(record, 'result_note'),
  };
}

/** 'YYYY-MM-DD' の差（b - a）を日数で返す。片方でも無ければ null */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

/** 事前共有が撮影の何日前だったか（2 なら「2日前」。マイナスは撮影後の共有） */
export function leadDays(rec) {
  return daysBetween(rec.sharedAt, rec.shootDate);
}

/** 案件の最終投稿日（投稿がまだ無ければ null） */
export function lastPostDate(rec) {
  const dates = rec.posts.map((p) => p.postDate).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

const HIGH = '🔴';
const MID = '🟡';

/**
 * 1案件を点検して、遅れ・抜けを並べる。
 *
 * @param {object} rec normalizeRecord の戻り
 * @param {object} opts { today: 'YYYY-MM-DD', rules }
 * @returns {Array<{level:string, code:string, message:string}>}
 */
export function checkRecord(rec, { today, rules }) {
  const alerts = [];
  const add = (level, code, message) => alerts.push({ level, code, message });
  const past = (iso, grace = 0) => {
    const d = daysBetween(iso, today);
    return d !== null && d > grace;
  };

  if (rec.status === '中止') return alerts;

  // ① 事前共有（撮影日の2日前まで）
  const lead = leadDays(rec);
  if (!rec.sharedAt) {
    add(HIGH, 'no_advance_notice', `事前共有の記録がありません（撮影日 ${rec.shootDate ?? '未定'}）`);
  } else if (lead !== null && lead < rules.advance_notice_days) {
    const how = lead < 0 ? `撮影${-lead}日後` : lead === 0 ? '撮影当日' : `${lead}日前`;
    add(HIGH, 'late_advance_notice', `事前共有が${how}でした（ルール: ${rules.advance_notice_days}日前まで）`);
  }

  // 事前報告として埋まっているべき欄（撮影前でも抜けていれば指摘する）
  const missing = [];
  if (!rec.place) missing.push('撮影場所');
  if (!rec.content) missing.push('撮影内容');
  if (!rec.cast) missing.push('出演者');
  if (!rec.planCount) missing.push('撮影本数');
  if (!rec.planMedia.length) missing.push('投稿予定媒体');
  if (!rec.planPostDate) missing.push('投稿予定日');
  if (!rec.planAd || rec.planAd === '未定') missing.push('広告利用の有無');
  if (missing.length) {
    add(MID, 'incomplete_advance_notice', `事前報告の未記入: ${missing.join('・')}`);
  }

  // ② 撮影後報告（撮影日の翌日まで）
  const shootPassed = past(rec.shootDate, 0);
  if (shootPassed && rec.shotCount === null) {
    if (past(rec.shootDate, rules.shoot_report_days)) {
      add(HIGH, 'no_shoot_report', `撮影後の報告がありません（撮影本数・編集予定本数・編集完了予定日）`);
    } else {
      add(MID, 'shoot_report_due', '撮影後の報告をお願いします（本数・編集予定）');
    }
  }
  if (shootPassed && rec.shotCount !== null && !rec.editDue && !rec.editDone) {
    add(MID, 'no_edit_due', '編集完了予定日が未記入です');
  }

  // ③ 編集の遅れ
  if (!rec.editDone && rec.editDue && past(rec.editDue, rules.edit_overdue_days)) {
    const late = daysBetween(rec.editDue, today);
    add(HIGH, 'edit_overdue', `編集が予定より${late}日遅れています（予定 ${rec.editDue}／担当 ${rec.editor ?? '未記入'}）`);
  }

  // ④ 投稿の遅れ・投稿報告の抜け
  if (!rec.posts.length && rec.planPostDate && past(rec.planPostDate, rules.post_overdue_days)) {
    const late = daysBetween(rec.planPostDate, today);
    add(HIGH, 'post_overdue', `投稿予定日から${late}日たっても投稿の記録がありません（予定 ${rec.planPostDate}）`);
  }
  rec.posts.forEach((p, i) => {
    const label = `投稿${i + 1}${p.postDate ? `（${p.postDate}）` : ''}`;
    if (!p.url) add(MID, 'no_post_url', `${label}: 投稿URLが未記入です`);
    if (!p.media || !p.format || !p.type) add(MID, 'no_post_kind', `${label}: 媒体・投稿形態・種類のいずれかが未記入です`);
    if (p.ad && !p.adCost) add(MID, 'no_ad_cost', `${label}: 広告を使ったのに広告費が未記入です`);
  });

  // ⑤ 成果（流入・予約）
  const posted = lastPostDate(rec);
  if (posted && past(posted, rules.result_days_after_post) && (rec.inflow === null || rec.reserve === null)) {
    add(HIGH, 'no_result', `投稿から${rules.result_days_after_post}日以上たっても流入・予約が未入力です（最終投稿 ${posted}）`);
  }

  return alerts;
}

/** 数字の足し算（null は 0 として扱うが「未入力」は件数に数える） */
function add(a, b) {
  return (a ?? 0) + (b ?? 0);
}

/**
 * 期間ぶんの案件をまとめる。
 *
 * @param {Array<object>} records normalizeRecord 済みの配列
 * @param {object} opts { today, rules, targets, from, to }
 */
export function summarize(records, { today, rules, targets = {}, from = null, to = null } = {}) {
  const inRange = (iso) => {
    if (!iso) return false;
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  };

  const items = records.filter((r) => (from || to ? inRange(r.shootDate) || r.posts.some((p) => inRange(p.postDate)) : true));

  const totals = {
    shoots: 0,
    shotCount: 0,
    editCount: 0,
    posts: 0,
    views: 0,
    clicks: 0,
    adCost: 0,
    inflow: 0,
    reserve: 0,
    visit: 0,
    sales: 0,
  };
  const byMedia = {};
  const byStatus = {};
  const alerts = [];

  for (const r of items) {
    if (r.status !== '中止') totals.shoots += 1;
    totals.shotCount = add(totals.shotCount, r.shotCount);
    totals.editCount = add(totals.editCount, r.editCount);
    totals.inflow = add(totals.inflow, r.inflow);
    totals.reserve = add(totals.reserve, r.reserve);
    totals.visit = add(totals.visit, r.visit);
    totals.sales = add(totals.sales, r.sales);
    byStatus[r.status ?? '(未設定)'] = (byStatus[r.status ?? '(未設定)'] ?? 0) + 1;

    for (const p of r.posts) {
      if (from || to ? inRange(p.postDate) : true) {
        totals.posts += 1;
        totals.views = add(totals.views, p.views);
        totals.clicks = add(totals.clicks, p.clicks);
        totals.adCost = add(totals.adCost, p.adCost);
        const key = p.media ?? '(媒体未記入)';
        byMedia[key] = byMedia[key] ?? { posts: 0, views: 0, adCost: 0 };
        byMedia[key].posts += 1;
        byMedia[key].views += p.views ?? 0;
        byMedia[key].adCost += p.adCost ?? 0;
      }
    }

    for (const a of checkRecord(r, { today, rules })) {
      alerts.push({ ...a, title: r.title, id: r.id, owner: r.owner, editor: r.editor });
    }
  }

  const cpa = totals.reserve > 0 ? Math.round(totals.adCost / totals.reserve) : null;

  return {
    from,
    to,
    today,
    totals,
    byMedia,
    byStatus,
    cpa,
    targets,
    // 目的（予約）まで届いたか。ここが見たいのであって、投稿数ではない。
    cpaOver: cpa !== null && targets.cpa_yen ? cpa > targets.cpa_yen : false,
    alerts,
    items,
  };
}

/** 今日を含む週（月曜はじまり）の [月曜, 日曜] を返す */
export function weekRange(todayISO) {
  const d = new Date(`${todayISO}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 月=0
  const monday = new Date(d.getTime() - dow * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const iso = (x) => x.toISOString().slice(0, 10);
  return [iso(monday), iso(sunday)];
}

/** 月の [初日, 末日] を返す（month は 'YYYY-MM'） */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

const yen = (n) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const cnt = (n) => Number(n ?? 0).toLocaleString('ja-JP');

/**
 * Chatwork / LINE に貼れるテキストにする。
 * 長文は読まれないので、上から「遅れ → 数字 → 予定」の順に短く並べます。
 */
export function formatKoreaSnsReport(s, { title = '韓国SNS 週次まとめ（明洞）' } = {}) {
  const L = [];
  const period = s.from && s.to ? `${s.from} 〜 ${s.to}` : s.today;
  L.push(`【${title}】${period}`);

  // ① まず「止まっているもの」。ここを直さないと数字は動かない。
  const high = s.alerts.filter((a) => a.level === HIGH);
  const mid = s.alerts.filter((a) => a.level === MID);
  L.push('');
  if (!s.alerts.length) {
    L.push('■ 要対応: なし（報告の抜け・遅れはありません）');
  } else {
    L.push(`■ 要対応 ${high.length}件${mid.length ? `（ほか要確認 ${mid.length}件）` : ''}`);
    for (const a of high.slice(0, 10)) L.push(`${a.level} ${a.title}: ${a.message}`);
    for (const a of mid.slice(0, 10)) L.push(`${a.level} ${a.title}: ${a.message}`);
    const rest = high.length + mid.length - Math.min(high.length, 10) - Math.min(mid.length, 10);
    if (rest > 0) L.push(`… ほか ${rest}件（kintoneの一覧で確認してください）`);
  }

  // ② 数字（撮影 → 投稿 → 広告 → 流入 → 予約）
  const t = s.totals;
  L.push('');
  L.push('■ 数字');
  L.push(`撮影 ${cnt(t.shoots)}件 / 撮影本数 ${cnt(t.shotCount)} → 編集予定 ${cnt(t.editCount)} → 投稿 ${cnt(t.posts)}本`);
  L.push(`再生 ${cnt(t.views)} / クリック ${cnt(t.clicks)} / 広告費 ${yen(t.adCost)}`);
  L.push(`流入 ${cnt(t.inflow)} → 予約 ${cnt(t.reserve)} → 来店 ${cnt(t.visit)} / 売上 ${yen(t.sales)}`);
  if (s.cpa !== null) {
    const mark = s.cpaOver ? '🔴' : '🟢';
    const target = s.targets.cpa_yen ? `（目標 ${yen(s.targets.cpa_yen)}以内）` : '';
    L.push(`${mark} 予約1件あたりの広告費 ${yen(s.cpa)}${target}`);
  } else if (t.adCost > 0) {
    L.push('🟡 広告費は出ているが予約が未入力のため、費用対効果が出せません');
  }

  // ③ 媒体別（どこが効いているか）
  const media = Object.entries(s.byMedia).sort((a, b) => b[1].views - a[1].views);
  if (media.length) {
    L.push('');
    L.push('■ 媒体別');
    for (const [name, m] of media) {
      L.push(`${name}: ${cnt(m.posts)}本 / 再生 ${cnt(m.views)}${m.adCost ? ` / 広告 ${yen(m.adCost)}` : ''}`);
    }
  }

  // ④ 次にやること（進捗の内訳＝いま誰が何をしているか）
  const status = Object.entries(s.byStatus).sort();
  if (status.length) {
    L.push('');
    L.push('■ 進捗');
    L.push(status.map(([k, v]) => `${k} ${v}件`).join(' / '));
  }

  return L.join('\n');
}

/** 終了コード用: 🔴 が1件でもあれば true */
export function hasBlocker(summary) {
  return summary.alerts.some((a) => a.level === HIGH);
}
