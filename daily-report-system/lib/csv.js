// ============================================================
//  CSV / TSV の読み込み（日本の管理画面から落としたファイル向け）
// ------------------------------------------------------------
//  Amazon・楽天・RPP などからダウンロードしたファイルは
//  くせが強いので、そこを吸収するのがこのファイルの役目です。
//
//   ・文字コードが Shift_JIS のことが多い（そのまま読むと文字化け）
//   ・先頭に BOM が付いていることがある
//   ・改行が CRLF（Windows形式）
//   ・項目の中にカンマや改行が入っている（"1,234" のように引用符で囲まれる）
//   ・タブ区切り（.tsv）の場合もある
//
//  外部ライブラリは使いません（Node 18+ の標準機能だけで動きます）。
// ============================================================

/**
 * バイト列の文字コードを推定して文字列にする。
 *
 * 判定の順番:
 *   1. BOM があれば、それが正解（UTF-8 BOM 付きは Excel が付ける）
 *   2. UTF-8 として矛盾なく読めれば UTF-8
 *   3. それ以外は Shift_JIS（日本の管理画面の既定）
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {{text: string, encoding: string}}
 */
export function decodeText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  // UTF-8 の BOM (EF BB BF)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  // UTF-16 LE / BE の BOM
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }

  // BOM なし。UTF-8 として厳密に読めるか試す。
  // fatal:true にすると、UTF-8 として不正なバイト列で例外になる。
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8' };
  } catch {
    // UTF-8 ではない → 日本のCSVはまず Shift_JIS（CP932）
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' };
  }
}

/** 区切り文字を推定する（1行目に多く出てくる方を採用） */
export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

/**
 * CSV 本体を配列の配列に変換する。
 *
 * 引用符（"）の中のカンマ・改行はそのまま値として扱います。
 * 引用符の中の "" は 1個の " として扱います（CSVの決まり）。
 *
 * @param {string} text
 * @param {string} [delimiter] 省略時は自動判定
 * @returns {string[][]}
 */
export function parseCsv(text, delimiter) {
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" → " （エスケープされた引用符）
          i++;
        } else {
          inQuotes = false; // 引用符おわり
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // CRLF の \r は捨てる（次の \n で行を確定させる）
      if (text[i + 1] !== '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  // 最終行（末尾に改行が無いファイル対策）
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 完全な空行は落とす（末尾の余分な改行など）
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/**
 * ファイルの中身（バイト列）を「見出し付きの行の配列」にする。
 *
 * @param {Buffer|Uint8Array} buf
 * @param {object} [opts] { skipRows: 見出しの前に読み飛ばす行数 }
 * @returns {{headers: string[], rows: object[], encoding: string, delimiter: string}}
 */
export function readTable(buf, opts = {}) {
  const { text, encoding } = decodeText(buf);
  const delimiter = detectDelimiter(text);
  let matrix = parseCsv(text, delimiter);

  // 管理画面によっては先頭に「レポート期間: ...」などの説明行が入る
  const skip = Number(opts.skipRows) || 0;
  if (skip > 0) matrix = matrix.slice(skip);

  if (matrix.length === 0) return { headers: [], rows: [], encoding, delimiter };

  const headers = matrix[0].map((h) => normalizeHeader(h));
  const rows = matrix.slice(1).map((cells) => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === '') continue;
      obj[headers[i]] = (cells[i] ?? '').trim();
    }
    return obj;
  });

  return { headers, rows, encoding, delimiter };
}

/**
 * 見出しのゆらぎを吸収する。
 * 全角スペース・前後の空白・引用符・全角英数を揃えます。
 * （「商品名 」と「商品名」を別物にしないため）
 */
export function normalizeHeader(h) {
  return String(h ?? '')
    .replace(/^﻿/, '') // 行頭に残った BOM
    .replace(/[　\s]+/g, '') // 空白（全角含む）を除去
    .replace(/^["']|["']$/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}
