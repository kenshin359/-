// ============================================================
//  日報レコードから「日付・氏名・本文」を取り出す（構造非依存）
// ------------------------------------------------------------
//  リベティの日報アプリは、下記のような「横に広がる」構造になっている：
//
//    レコード
//    ├ 各チーム名入力: LP
//    ├ テーブル … 2026-07-01 19:37 ┬ 氏名 ミツワ ＋ 日報（本文）
//    │                              ├ 氏名 三浦   ＋ 日報（本文）
//    │                              └ 氏名 久保   ＋ 日報（本文）
//    ├ テーブル … 2026-07-02 19:37 ┬ 同じく複数人分
//    └ …（日付ごとに続く）
//
//  フィールドコードが不明でも動くよう、"形" から判定する方式にしている。
//  アプリの項目名が変わっても、原則そのまま動き続ける。
//
//  判定ルール（上から順に適用）:
//    - 日付/日時に見える値      → その行の「日付」として記憶
//    - 短い文字列（改行なし）    → 直後の本文の「氏名」候補として記憶
//    - 長い文字列 or 改行あり    → 「本文」とみなし、直前の日付・氏名と組にする
// ============================================================

// 本文とみなす最小の長さ（これ未満は氏名などの短い値とみなす）
const TEXT_MIN_LENGTH = 25;
// 氏名とみなす最大の長さ
const NAME_MAX_LENGTH = 20;

/** 値が日付・日時に見えるか（2026-07-01 / 2026-07-01T10:00:00Z など） */
export function looksLikeDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim());
}

/** 日付・日時から YYYY-MM-DD 部分だけ取り出す */
export function toDateISO(value) {
  const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** 値が「本文」に見えるか（長い、または改行を含む） */
function looksLikeBody(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return s.includes('\n') || s.length >= TEXT_MIN_LENGTH;
}

/** 値が「氏名」に見えるか（短い1行の文字列） */
function looksLikeName(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return s.length > 0 && s.length <= NAME_MAX_LENGTH && !s.includes('\n') && !looksLikeDate(s);
}

// kintone のフィールド値を素の値に変換する
// （USER_SELECT などは配列で来るので、名前を取り出す）
function plainValue(field) {
  if (!field || typeof field !== 'object') return null;
  const v = field.value;
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) {
    // ユーザー選択・組織選択・チェックボックスなど
    const names = v.map((x) => (x && typeof x === 'object' ? x.name ?? x.code ?? '' : String(x))).filter(Boolean);
    return names.length ? names.join(', ') : null;
  }
  if (typeof v === 'object') return null; // サブテーブルなどは別処理
  return String(v);
}

/**
 * 1つの「行」（レコード本体 or サブテーブルの1行）から日報を取り出す。
 * 出現順に走査し、日付→氏名→本文 の並びを組にしていく。
 *
 * @param {object} row     { フィールドコード: { value } } の形
 * @param {object} ctx     { team, fallbackDate }
 * @returns {Array<{date, reporter, text, team}>}
 */
function fromRow(row, ctx = {}) {
  const found = [];
  let currentDate = ctx.fallbackDate ?? null;
  let pendingName = null;

  for (const [code, field] of Object.entries(row)) {
    if (code.startsWith('$')) continue; // $id / $revision は無視
    const value = plainValue(field);
    if (value === null) continue;

    if (looksLikeDate(value)) {
      currentDate = toDateISO(value);
      continue;
    }
    if (looksLikeBody(value)) {
      found.push({
        date: currentDate,
        reporter: pendingName,
        team: ctx.team ?? null,
        text: value.trim(),
      });
      pendingName = null; // 氏名は1回使ったら消費する
      continue;
    }
    if (looksLikeName(value)) {
      pendingName = value.trim();
    }
  }
  return found;
}

// レコードから「チーム名」らしき値を探す（各チーム名入力 など）
function findTeam(record) {
  for (const [code, field] of Object.entries(record)) {
    if (code.startsWith('$')) continue;
    if (/team|チーム/i.test(code)) {
      const v = plainValue(field);
      if (v) return v;
    }
  }
  return null;
}

// サブテーブルかどうか（value が配列で、各要素が { value: {...} } の形）
function isSubtable(field) {
  return (
    field &&
    Array.isArray(field.value) &&
    field.value.length > 0 &&
    field.value[0] &&
    typeof field.value[0] === 'object' &&
    field.value[0].value &&
    typeof field.value[0].value === 'object'
  );
}

/**
 * 日報レコード群から、すべての「日付・氏名・本文」を取り出す。
 * @param {Array} records kintone レコード配列
 * @returns {Array<{date, reporter, team, text}>}
 */
export function extractReports(records) {
  const out = [];

  for (const record of records ?? []) {
    if (!record || typeof record !== 'object') continue;
    const team = findTeam(record);

    // ① サブテーブル（テーブル）を処理
    //    1つの表が1日分で、その中に複数人の氏名＋本文が並ぶ
    for (const [code, field] of Object.entries(record)) {
      if (code.startsWith('$')) continue;
      if (!isSubtable(field)) continue;
      for (const row of field.value) {
        out.push(...fromRow(row.value, { team }));
      }
    }

    // ② トップレベルにも日報本文が置かれている場合に対応
    const topLevel = {};
    for (const [code, field] of Object.entries(record)) {
      if (code.startsWith('$')) continue;
      if (isSubtable(field)) continue;
      topLevel[code] = field;
    }
    out.push(...fromRow(topLevel, { team }));
  }

  // 本文が空のものは捨てる
  return out.filter((r) => r.text && r.text.length > 0);
}

/**
 * 指定日の日報だけに絞り込む。
 * 日付が取れなかったものは、除外せず「日付不明」として残すか選べる。
 *
 * @param {Array} reports extractReports の結果
 * @param {string} dateISO 'YYYY-MM-DD'
 * @param {object} opts { includeUndated=false }
 */
export function filterByDate(reports, dateISO, opts = {}) {
  return reports.filter((r) => {
    if (r.date === dateISO) return true;
    if (opts.includeUndated && !r.date) return true;
    return false;
  });
}

/**
 * Claude に渡す入力データの形に整える。
 * 既存の buildAnalysisInput と同じ形にそろえ、後段をそのまま使えるようにする。
 */
export function buildInputFromExtracted(dateISO, reports, previousIssues = []) {
  return {
    dateISO,
    company: '株式会社リベティ (Libetee)',
    // 構造化された項目が無いため、本文をそのまま渡してClaudeに読ませる
    reports: reports.map((r) => ({
      report_date: r.date,
      reporter: r.reporter ?? '（氏名不明）',
      team: r.team ?? null,
      body: r.text,
    })),
    previousIssues,
    report_count: reports.length,
    note: '各日報は自由記述の本文です。項目が分かれていないため、本文から成果・問題・依頼などを読み取ってください。',
  };
}
