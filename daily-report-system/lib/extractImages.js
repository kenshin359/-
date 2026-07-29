// ============================================================
//  日報アプリから「日付・氏名・日報画像」を取り出す
// ------------------------------------------------------------
//  【実機調査でわかった構造（2026-07-29 確認）】
//
//  リベティの日報は **文章ではなく画像（スクリーンショット）** です。
//  Excelの「株式会社リベティ 業務日報」フォーマットを画像で添付しています。
//
//    レコード（1件＝1チームの数週間分）
//    ├ ドロップダウン: 各チーム名入力（LP / General Affairs / Marketing / Support）
//    ├ テーブル_0  … 日時_0 ＋ 氏名×4 ＋ 日報(添付ファイル)×4   ← 1日分
//    ├ テーブル_1  … 日時_1 ＋ 氏名×4 ＋ 日報(添付ファイル)×4   ← 別の日
//    └ …（テーブル_0 〜 テーブル_30 まで日付ごとに存在）
//
//  【氏名と画像の対応】
//  フィールドコードの **末尾の番号** で対応します：
//      文字列__1行__111（氏名）  ↔  添付ファイル_111（日報画像）
//      文字列__1行__112（氏名）  ↔  添付ファイル_112（日報画像）
//  この番号でペアリングしないと、氏名と日報が入れ違います。
// ============================================================

// フィールドコード末尾の番号を取り出す（対応付けの鍵）
// 例: '文字列__1行__111' → '111' / '添付ファイル_111' → '111'
// 番号が無いもの（'添付ファイル' '文字列__1行_'）は '' を返し、互いに対応させる
function pairKey(code) {
  const m = code.match(/_(\d+)$/);
  return m ? m[1] : '';
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

// レコードからチーム名を探す（ドロップダウン「各チーム名入力」）
function findTeam(record) {
  for (const [code, field] of Object.entries(record)) {
    if (code.startsWith('$')) continue;
    if (field?.type === 'DROP_DOWN' && field.value) return field.value;
  }
  return null;
}

/**
 * 日報レコード群から「日付・氏名・画像」の組を取り出す。
 *
 * @param {Array} records kintone レコード配列
 * @returns {Array<{date, reporter, team, files: Array<{name, key, type, size}>}>}
 */
export function extractImageReports(records) {
  const out = [];

  for (const record of records ?? []) {
    if (!record || typeof record !== 'object') continue;
    const team = findTeam(record);

    for (const [, field] of Object.entries(record)) {
      if (!isSubtable(field)) continue;

      for (const row of field.value) {
        const cells = row.value;
        let date = null;
        const names = {}; // 番号 → 氏名
        const files = {}; // 番号 → 添付ファイル配列

        for (const [code, cell] of Object.entries(cells)) {
          if (!cell) continue;
          if (cell.type === 'DATETIME' && cell.value) {
            date = String(cell.value).slice(0, 10); // YYYY-MM-DD
          } else if (cell.type === 'SINGLE_LINE_TEXT') {
            names[pairKey(code)] = cell.value || null;
          } else if (cell.type === 'FILE') {
            files[pairKey(code)] = Array.isArray(cell.value) ? cell.value : [];
          }
        }

        // 同じ番号の「氏名」と「日報画像」を組にする
        for (const key of Object.keys(files)) {
          const list = files[key] ?? [];
          if (!list.length) continue; // 画像が無い列は提出なしとみなす
          out.push({
            date,
            reporter: names[key] || null,
            team,
            files: list.map((f) => ({
              name: f.name,
              key: f.fileKey,
              type: f.contentType,
              size: f.size ? Number(f.size) : null,
            })),
          });
        }
      }
    }
  }

  // 日付順に並べる（日付不明は末尾）
  return out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

/** 指定日の日報だけに絞り込む */
export function filterByDate(reports, dateISO) {
  return reports.filter((r) => r.date === dateISO);
}

/** データが存在する日付の一覧（新しい順） */
export function availableDates(reports) {
  return [...new Set(reports.map((r) => r.date).filter(Boolean))].sort().reverse();
}

/**
 * 氏名の表記ゆれを揃える（「関本 彩乃」と「関本彩乃」を同一人物として扱う）
 * 集計時のみ使用し、表示は原文のままにする。
 */
export function normalizeName(name) {
  return name ? String(name).replace(/[\s　]/g, '') : null;
}
