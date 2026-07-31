// ============================================================
//  在庫管理アプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = 1日。
//  上に「元ファイルの置き場」、下に「商品ごとの在庫数」が並びます。
//
//    Amazon在庫   … FBA倉庫にある在庫
//    CS在庫       … CS倉庫＋事務所にある在庫
//
//  ★なぜ Amazon と CS を分けるのか
//    Amazon(FBA)の在庫は Amazon の倉庫にあり、
//    楽天・自社サイトの注文には使えません。
//    合算すると「在庫はあるのに出荷できない」が起きます。
//    欠品の判断を誤らないため、必ず分けて持ちます。
//
//  ★なぜ「事務所」を CS に含めるのか
//    社長のご指定です。出荷元としては同じ扱いになるためです。
//    内訳を残したいときは、明細の備考欄に書いてください。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export const APP_NAME = '在庫管理';

/** 在庫ファイルの置き場 */
export const STOCK_SLOTS = [
  { code: 'f_stock_amazon', label: '在庫ファイル｜Amazon（FBA）', warehouse: 'Amazon' },
  { code: 'f_stock_cs', label: '在庫ファイル｜CS（倉庫＋事務所）', warehouse: 'CS' },
];

/**
 * 商品の選択肢。売上側の対応表と広告側の対応表から作ります。
 * ★1か所で商品を増やせば、在庫・広告・売上のどこでも同じ名前が使えます。
 */
export function productOptions() {
  const names = new Set();
  for (const file of ['product-aliases.json', 'ad-campaign-rules.json']) {
    try {
      const j = JSON.parse(readFileSync(join(HERE, '..', 'config', file), 'utf8'));
      for (const p of j.products ?? []) if (p.canonical) names.add(p.canonical);
    } catch {
      // 対応表が無くても、アプリは作れるようにしておく
    }
  }
  names.add('その他');
  return [...names];
}

function toOptions(list) {
  const o = {};
  list.forEach((label, i) => {
    o[label] = { label, index: String(i) };
  });
  return o;
}

/** 明細テーブル（商品ごとの在庫数） */
export function detailFields() {
  return {
    i_product: {
      type: 'DROP_DOWN', code: 'i_product', label: '商品', required: true,
      options: toOptions(productOptions()),
    },
    i_sku: {
      type: 'SINGLE_LINE_TEXT', code: 'i_sku', label: 'SKU/商品管理番号', required: false,
    },
    i_amazon: {
      type: 'NUMBER', code: 'i_amazon', label: 'Amazon在庫', required: false,
      unit: '個', unitPosition: 'AFTER', digit: true, defaultValue: '0',
    },
    i_cs: {
      type: 'NUMBER', code: 'i_cs', label: 'CS在庫(倉庫＋事務所)', required: false,
      unit: '個', unitPosition: 'AFTER', digit: true, defaultValue: '0',
    },
    i_total: {
      type: 'CALC', code: 'i_total', label: '合計', required: false,
      expression: 'i_amazon + i_cs',
      format: 'NUMBER_DIGIT', unit: '個', unitPosition: 'AFTER',
    },
    i_incoming: {
      type: 'NUMBER', code: 'i_incoming', label: '入荷予定数', required: false,
      unit: '個', unitPosition: 'AFTER', digit: true,
    },
    i_incoming_date: {
      type: 'DATE', code: 'i_incoming_date', label: '入荷予定日', required: false,
    },
    i_status: {
      type: 'DROP_DOWN', code: 'i_status', label: '状態', required: false,
      options: toOptions(['在庫あり', '残りわずか', '欠品', '販売停止']),
    },
    i_note: {
      type: 'SINGLE_LINE_TEXT', code: 'i_note', label: '備考（事務所分の内訳など）', required: false,
    },
  };
}

export const FIELDS = {
  snapshot_date: {
    type: 'DATE', code: 'snapshot_date', label: '基準日', required: true,
    defaultNowValue: true,
  },
  staff: {
    type: 'USER_SELECT', code: 'staff', label: '入力者', required: false,
    defaultValue: [{ type: 'FUNCTION', code: 'LOGINUSER()' }],
  },

  // ── 元ファイルの置き場 ──
  ...Object.fromEntries(
    STOCK_SLOTS.map((s) => [s.code, { type: 'FILE', code: s.code, label: s.label, required: false, thumbnailSize: '150' }])
  ),

  // ── 合計（明細の自動計算。画面の上に出ます）──
  total_amazon: {
    type: 'CALC', code: 'total_amazon', label: 'Amazon在庫 合計（自動）', required: false,
    expression: 'SUM(i_amazon)', format: 'NUMBER_DIGIT', unit: '個', unitPosition: 'AFTER',
  },
  total_cs: {
    type: 'CALC', code: 'total_cs', label: 'CS在庫 合計（自動）', required: false,
    expression: 'SUM(i_cs)', format: 'NUMBER_DIGIT', unit: '個', unitPosition: 'AFTER',
  },
  total_all: {
    type: 'CALC', code: 'total_all', label: '総在庫数（自動）', required: false,
    expression: 'SUM(i_total)', format: 'NUMBER_DIGIT', unit: '個', unitPosition: 'AFTER',
  },

  detail: {
    type: 'SUBTABLE', code: 'detail', label: '在庫明細（商品 × 倉庫）',
    fields: detailFields(),
  },

  source: {
    type: 'DROP_DOWN', code: 'source', label: '入力方法', required: false,
    options: toOptions(['手入力', 'CSV取込']),
    defaultValue: '手入力',
  },
  import_log: {
    type: 'MULTI_LINE_TEXT', code: 'import_log', label: '取込ログ（自動記入）', required: false,
  },
  note: {
    type: 'MULTI_LINE_TEXT', code: 'note', label: '備考', required: false,
  },

  // 同じ日を二重に作らないための鍵（1日1レコード）
  dedup_key: {
    type: 'SINGLE_LINE_TEXT', code: 'dedup_key', label: '重複防止キー',
    required: false, unique: true,
  },
};

/** 重複防止キー（1日1レコードなので基準日そのもの） */
export function dedupKey(dateISO) {
  return String(dateISO);
}

/** レコードから「どの置き場にファイルがあるか」を調べる */
export function slotStatus(record) {
  return STOCK_SLOTS.map((s) => {
    const files = record?.[s.code]?.value ?? [];
    return {
      ...s,
      count: files.length,
      filled: files.length > 0,
      files: files.map((f) => ({ name: f.name, fileKey: f.fileKey, size: Number(f.size) || 0 })),
    };
  });
}

/** 明細を「1行 = 1商品」の素直な形にする */
export function flattenDetail(record) {
  const date = record?.snapshot_date?.value ?? null;
  return (record?.detail?.value ?? []).map((row) => {
    const v = row.value ?? {};
    const num = (f) => {
      const n = Number(v[f]?.value);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      date,
      product: v.i_product?.value ?? '',
      sku: v.i_sku?.value ?? '',
      amazon: num('i_amazon'),
      cs: num('i_cs'),
      total: num('i_amazon') + num('i_cs'),
      incoming: num('i_incoming'),
      incomingDate: v.i_incoming_date?.value ?? null,
      status: v.i_status?.value ?? '',
      note: v.i_note?.value ?? '',
    };
  });
}
