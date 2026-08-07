// Googleスプレッドシートを「認証なし」で読み取ります。
//   リンク共有（閲覧可）のシートは、CSVエクスポートURLで中身を取得できます。
//   → 依存ライブラリ不要・GitHub Actions でもそのまま動きます。
//
// ★注意：シートは「リンクを知っている全員が閲覧可」になっている必要があります。
//   非公開だとログインページのHTMLが返るので、その場合は分かりやすいエラーにします。

// 共有URLから スプレッドシートID と gid（タブ）を取り出す
export function parseSheetUrl(url) {
  const idMatch = String(url).match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = String(url).match(/[?&#]gid=(\d+)/);
  return {
    id: idMatch ? idMatch[1] : "",
    gid: gidMatch ? gidMatch[1] : "",
  };
}

// CSVエクスポートURLを組み立てて取得
export async function fetchSheetCsv(url) {
  const { id, gid } = parseSheetUrl(url);
  if (!id) {
    throw new Error(
      `スプレッドシートのURLからIDを取り出せませんでした: ${url}\n（.env の CHINA_SHEET_URL に共有URLを入れてください）`
    );
  }
  let csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  if (gid) csvUrl += `&gid=${gid}`;

  const res = await fetch(csvUrl, { redirect: "follow" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`スプレッドシートの取得に失敗（HTTP ${res.status}）: ${csvUrl}`);
  }
  // 非公開だとログインHTMLが返る（CSVではない）。見分けて分かりやすく案内。
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(
      `スプレッドシートを読めませんでした（ログインページが返りました）。\n` +
        `→ シートの共有設定を「リンクを知っている全員（閲覧者）」にしてください: ${url}`
    );
  }
  return text;
}

// ★依存を増やさない小さなCSVパーサ（RFC4180準拠）。
//   ・" で囲まれたフィールド内のカンマ・改行・"" を正しく扱う
//   （このシートは注文番号が改行入りの引用符で入っているため、素朴なsplitでは壊れる）
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // 無視（CRLF対応）
      } else {
        field += c;
      }
    }
  }
  // 最後のフィールド／行
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// CSV文字列 → { headers, records }
//   ヘッダは「日付」を含む最初の行とみなす（先頭の空行対策）。
export function toRecords(text) {
  const rows = parseCsv(text);
  let hi = rows.findIndex((r) => r.some((c) => c.trim() === "日付"));
  if (hi === -1) hi = 0;
  const headers = rows[hi].map((h) => h.trim());
  const records = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => (c ?? "").trim() === "")) continue; // 空行スキップ
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    records.push(obj);
  }
  return { headers, records };
}
