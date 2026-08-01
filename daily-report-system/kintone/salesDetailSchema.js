// ============================================================
//  売上明細（自動取込）アプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = 1日。
//  明細テーブルに「販売先 × 商品」ごとの数量と売上が入ります。
//
//  ★なぜ既存の「売上・転換率報告」アプリに書き足さないのか
//    あちらはスタッフが手で入力しているアプリです。
//    自動で書き足すと、どちらが正しいのか分からなくなります。
//    別アプリにして、突き合わせて差が出たときに気づける形にします。
//
//  ★商品の紐づけは「確実に分かるものだけ確定」にします。
//    SKU/ASIN の対応表にあるものは確定。
//    商品名からの推測は「要確認」として残し、勝手に断定しません。
//    売上を違う商品に付けると、伸びている商品を見誤るためです。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export const APP_NAME = '売上明細（自動取込）';

export const CHANNEL_OPTIONS = ['Amazon', '楽天', '自社サイト', 'TikTok Shop', 'その他'];

/** 商品名が分からないときに使う選択肢。中身が分かる名前にしておく */
export const UNKNOWN_PRODUCT = '未分類';
/** 元ファイルに商品別の内訳が入っていなかったとき（楽天の店舗データなど） */
export const NO_BREAKDOWN = '(商品別内訳なし)';

/** 商品の選択肢（売上・広告の対応表から作る。1か所直せば全部に効く） */
export function productOptions() {
  const names = new Set();
  for (const file of ['product-aliases.json', 'ad-campaign-rules.json']) {
    try {
      const j = JSON.parse(readFileSync(join(HERE, '..', 'config', file), 'utf8'));
      for (const p of j.products ?? []) if (p.canonical) names.add(p.canonical);
    } catch {
      // 対応表が無くてもアプリは作れるようにしておく
    }
  }
  names.add(UNKNOWN_PRODUCT);
  // ★店舗全体の合計しか無いファイル（楽天RMSの日次店舗データ）を入れる先。
  //   金額は正しいので捨てず、「内訳が無い」ことが画面で分かるようにします。
  names.add(NO_BREAKDOWN);
  return [...names];
}

function toOptions(list) {
  const o = {};
  list.forEach((label, i) => {
    o[label] = { label, index: String(i) };
  });
  return o;
}

export function detailFields() {
  return {
    s_channel: {
      type: 'DROP_DOWN', code: 's_channel', label: '販売先', required: true,
      options: toOptions(CHANNEL_OPTIONS),
    },
    s_product: {
      type: 'DROP_DOWN', code: 's_product', label: '商品', required: false,
      options: toOptions(productOptions()),
      defaultValue: '未分類',
    },
    s_sku: {
      type: 'SINGLE_LINE_TEXT', code: 's_sku', label: 'SKU', required: false,
    },
    s_asin: {
      type: 'SINGLE_LINE_TEXT', code: 's_asin', label: 'ASIN/商品コード', required: false,
    },
    s_title: {
      type: 'SINGLE_LINE_TEXT', code: 's_title', label: '元の商品名', required: false,
    },
    s_qty: {
      type: 'NUMBER', code: 's_qty', label: '数量', required: false,
      unit: '個', unitPosition: 'AFTER', digit: true, defaultValue: '0',
    },
    s_amount: {
      type: 'NUMBER', code: 's_amount', label: '売上', required: false,
      unit: '円', unitPosition: 'AFTER', digit: true, defaultValue: '0',
    },
    s_orders: {
      type: 'NUMBER', code: 's_orders', label: '注文数', required: false, digit: true,
    },
    // 0で割らないよう分岐を入れる（返品で数量0になる日がある）
    s_unit_price: {
      type: 'CALC', code: 's_unit_price', label: '平均単価', required: false,
      expression: 'IF(s_qty > 0, s_amount / s_qty, 0)',
      format: 'NUMBER_DIGIT', unit: '円', unitPosition: 'AFTER',
    },
    s_confidence: {
      type: 'DROP_DOWN', code: 's_confidence', label: '紐づけ', required: false,
      options: toOptions(['確定', '要確認']),
      defaultValue: '要確認',
    },
  };
}

export const FIELDS = {
  report_date: {
    type: 'DATE', code: 'report_date', label: '対象日', required: true,
    defaultNowValue: true,
  },

  total_amount: {
    type: 'CALC', code: 'total_amount', label: '売上合計（自動）', required: false,
    expression: 'SUM(s_amount)', format: 'NUMBER_DIGIT', unit: '円', unitPosition: 'AFTER',
  },
  total_qty: {
    type: 'CALC', code: 'total_qty', label: '数量合計（自動）', required: false,
    expression: 'SUM(s_qty)', format: 'NUMBER_DIGIT', unit: '個', unitPosition: 'AFTER',
  },

  detail: {
    type: 'SUBTABLE', code: 'detail', label: '売上明細（販売先 × 商品）',
    fields: detailFields(),
  },

  source: {
    type: 'DROP_DOWN', code: 'source', label: '入力方法', required: false,
    options: toOptions(['CSV取込', '手入力']),
    defaultValue: 'CSV取込',
  },
  import_log: {
    type: 'MULTI_LINE_TEXT', code: 'import_log', label: '取込ログ（自動記入）', required: false,
  },
  note: {
    type: 'MULTI_LINE_TEXT', code: 'note', label: '備考', required: false,
  },

  dedup_key: {
    type: 'SINGLE_LINE_TEXT', code: 'dedup_key', label: '重複防止キー',
    required: false, unique: true,
  },
};

/** 重複防止キー（1日1レコード） */
export function dedupKey(dateISO) {
  return String(dateISO);
}

/** 明細を「1行 = 1商品」の素直な形に開く */
export function flattenDetail(record) {
  const date = record?.report_date?.value ?? null;
  return (record?.detail?.value ?? []).map((row) => {
    const v = row.value ?? {};
    const num = (f) => {
      const n = Number(v[f]?.value);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      date,
      channel: v.s_channel?.value ?? '',
      product: v.s_product?.value ?? '未分類',
      sku: v.s_sku?.value ?? '',
      asin: v.s_asin?.value ?? '',
      title: v.s_title?.value ?? '',
      qty: num('s_qty'),
      amount: num('s_amount'),
      orders: num('s_orders'),
      confidence: v.s_confidence?.value ?? '要確認',
    };
  });
}
