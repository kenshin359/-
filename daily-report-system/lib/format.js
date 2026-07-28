// ============================================================
//  Claude の構造化出力 → 表示テキストの整形
// ------------------------------------------------------------
//  Claude は下記スキーマの JSON を返す想定（prompts/ 参照）：
//  {
//    conclusion: { status: '🟢'|'🟡'|'🔴', headline: string },
//    achievements: string[],
//    problems: string[],
//    approvals: string[],
//    delays: string[],
//    tomorrow_priorities: string[],
//    staff_summaries: [{ name, dept, text }],
//    ai_analysis: string,
//    ceo_items: string[],
//    manager_items: string[],
//    overall_rating: string,
//    urgent: boolean
//  }
//  値が無い項目は Claude が「情報不足」を入れる約束。
// ============================================================

const DASH = '情報不足';

// 配列を箇条書き文字列に。空なら「情報不足」。
function bullets(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return DASH;
  return arr.map((x) => `・${x}`).join('\n');
}

function line(s) {
  return s && String(s).trim() ? String(s).trim() : DASH;
}

/**
 * 社長・部長向け（Kintone保存 & 詳細表示）の本文を作る。
 * 30秒で読める粒度。
 */
export function formatCeoReport(a, dateISO) {
  const c = a.conclusion ?? {};
  const staff = (a.staff_summaries ?? [])
    .map((s) => `・${s.name}（${s.dept ?? '-'}）: ${line(s.text)}`)
    .join('\n');

  return `📋 Libetee 経営日報（${dateISO}）

【本日の結論】
${c.status ?? '🟡'} ${line(c.headline)}

【本日の成果】
${bullets(a.achievements)}

【問題】
${bullets(a.problems)}

【承認依頼】
${bullets(a.approvals)}

【進捗遅延】
${bullets(a.delays)}

【明日の最優先】
${bullets(a.tomorrow_priorities)}

【スタッフ別要約】
${staff || DASH}

【AI分析】
${line(a.ai_analysis)}`;
}

/**
 * LINE 通知用の本文を作る（簡潔版）。
 * 📊 Libetee 日報 / 結論 / 成果 / 要対応 / 承認 / 明日の最優先
 */
export function formatLineReport(a, dateISO) {
  const c = a.conclusion ?? {};
  // 「要対応」= 問題 + 進捗遅延 を短くまとめる
  const actionItems = [...(a.problems ?? []), ...(a.delays ?? [])];
  return `📊 Libetee 日報（${dateISO}）

【結論】${c.status ?? '🟡'} ${line(c.headline)}

【成果】
${bullets(a.achievements)}

【要対応】
${bullets(actionItems)}

【承認】
${bullets(a.approvals)}

【明日の最優先】
${bullets(a.tomorrow_priorities)}

詳細はKintoneをご確認ください。`;
}

/**
 * 緊急案件の LINE 即時通知本文。
 * 何が起きたか / 担当者 / 期限 / 現在の対応 / 必要な判断
 */
export function formatUrgentLine(incident, dateISO) {
  return `🚨 Libetee 緊急通知（${dateISO ?? ''}）

【内容】${line(incident.what)}
【担当者】${line(incident.owner)}
【期限】${line(incident.deadline)}
【現在の対応】${line(incident.current_action)}
【必要な判断】${line(incident.decision_needed)}

至急ご確認ください。`;
}

/**
 * Claude の構造化出力を、AI経営日報アプリの kintone レコード形式へ変換。
 * @param {object} a       Claude 出力
 * @param {string} dateISO 対象日
 * @param {string} lineBody LINE送信本文（保存用）
 */
export function toAiReportRecord(a, dateISO, lineBody) {
  const join = (arr) => (Array.isArray(arr) && arr.length ? arr.join('\n') : DASH);
  return {
    target_date: { value: dateISO },
    overall_rating: { value: line(a.overall_rating || a.conclusion?.status) },
    conclusion: { value: line(a.conclusion?.headline) },
    achievements: { value: join(a.achievements) },
    problems: { value: join(a.problems) },
    delays: { value: join(a.delays) },
    approvals: { value: join(a.approvals) },
    ceo_items: { value: join(a.ceo_items) },
    manager_items: { value: join(a.manager_items) },
    tomorrow_priorities: { value: join(a.tomorrow_priorities) },
    staff_summaries: {
      value: (a.staff_summaries ?? []).map((s) => `${s.name}(${s.dept ?? '-'}): ${s.text}`).join('\n') || DASH,
    },
    ai_analysis: { value: line(a.ai_analysis) },
    line_body: { value: lineBody || '' },
    gen_status: { value: '生成成功' },
    error_log: { value: '' },
  };
}
