// ============================================================
//  日次CSV提出ボックス  フィールド定義
// ------------------------------------------------------------
//  1レコード = 1日。
//  毎朝スタッフが、その日ぶんのCSVを1画面にまとめて置きます。
//
//    売上   … Amazon / 楽天 / Shopify / TikTok
//    広告   … Meta / RPP(楽天) / Google / その他
//
//  なぜ「1日1レコード・8つの置き場」なのか:
//    ・毎朝どこに何を置くかで迷わない（画面が1枚）
//    ・何が足りないかが一目で分かる
//    ・あとから「7/31のAmazonの元ファイル」をすぐ取り出せる
//
//  ★kintoneの計算式はファイルの有無を見られません。
//    そのため「8個中いくつ揃ったか」はアプリ側では出せず、
//    チェック用のスクリプト（npm run intake:check）が判定して
//    Chatworkに知らせます。
//    アプリに嘘の「完了」表示を作らないための割り切りです。
// ============================================================

export const APP_NAME = '日次CSV提出ボックス';

/** 売上ファイルの置き場（順番は画面に出る順） */
// channelId は config/sales-mapping.json の id と一致させること。
// ★置き場で媒体が決まるので、ファイル名は自由で構いません。
export const SALES_SLOTS = [
  { code: 'f_sales_amazon', label: '売上｜Amazon', channel: 'Amazon', channelId: 'amazon' },
  { code: 'f_sales_rakuten', label: '売上｜楽天', channel: '楽天', channelId: 'rakuten' },
  { code: 'f_sales_shopify', label: '売上｜Shopify(自社)', channel: '自社サイト', channelId: 'own' },
  { code: 'f_sales_tiktok', label: '売上｜TikTok Shop', channel: 'TikTok Shop', channelId: 'tiktok' },
];

/** 広告ファイルの置き場。media は「広告費管理」アプリの選択肢と揃えること */
export const AD_SLOTS = [
  { code: 'f_ad_meta', label: '広告｜Meta広告', media: 'Meta広告' },
  { code: 'f_ad_rpp', label: '広告｜RPP(楽天)', media: 'RPP(楽天)' },
  { code: 'f_ad_google', label: '広告｜Google広告', media: 'Google広告' },
  { code: 'f_ad_other', label: '広告｜その他広告', media: 'その他' },
];

export const ALL_SLOTS = [...SALES_SLOTS, ...AD_SLOTS];

function fileField(code, label) {
  return { type: 'FILE', code, label, required: false, thumbnailSize: '150' };
}

export const FIELDS = {
  report_date: {
    type: 'DATE', code: 'report_date', label: '対象日', required: true,
    defaultNowValue: true,
  },
  staff: {
    type: 'USER_SELECT', code: 'staff', label: '提出者', required: false,
    defaultValue: [{ type: 'FUNCTION', code: 'LOGINUSER()' }],
  },

  // ── 売上CSV ──
  ...Object.fromEntries(SALES_SLOTS.map((s) => [s.code, fileField(s.code, s.label)])),

  // ── 広告CSV ──
  ...Object.fromEntries(AD_SLOTS.map((s) => [s.code, fileField(s.code, s.label)])),

  status: {
    type: 'DROP_DOWN', code: 'status', label: '状態', required: false,
    options: {
      '提出中': { label: '提出中', index: '0' },
      '提出完了': { label: '提出完了', index: '1' },
      '取込済み': { label: '取込済み', index: '2' },
      '対象外(休業日)': { label: '対象外(休業日)', index: '3' },
    },
    defaultValue: '提出中',
  },

  // 取り込みスクリプトが「何をどう読んだか」を書き戻します。
  // 人が手で書く欄ではありません（消えても実害はありません）。
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

/** 重複防止キー（1日1レコードなので日付そのもの） */
export function dedupKey(dateISO) {
  return String(dateISO);
}

/** レコードから「どの置き場にファイルがあるか」を調べる */
export function slotStatus(record) {
  return ALL_SLOTS.map((s) => {
    const files = record?.[s.code]?.value ?? [];
    return {
      ...s,
      count: files.length,
      filled: files.length > 0,
      files: files.map((f) => ({ name: f.name, fileKey: f.fileKey, size: Number(f.size) || 0 })),
    };
  });
}
