// 「売上日報（新）」アプリのフィールド定義。
// 設計思想：1レコード＝1日。その中に「チャネル別実績」テーブルを持ち、
// 6チャネル × 各指標（売上・個数・アクセス・転換率・いいね率・まとめ買い率）を
// スプレッドシートのように毎日“落とし込む”。合計は計算フィールドで自動算出。

export const FIELDS = {
  // ── 日付 ──
  date: {
    type: 'DATE',
    code: 'date',
    label: '日付',
    required: true,
    unique: true, // 1日1レコードを担保
    defaultNowValue: false,
  },

  // ── 合計（テーブルから自動集計）──
  total_sales: {
    type: 'CALC',
    code: 'total_sales',
    label: '合計売上',
    expression: 'SUM(ch_sales)', // チャネル別実績の「売上」列を合算
    format: 'NUMBER',
    displayScale: '0',
    unit: '円',
    unitPosition: 'AFTER',
  },
  total_units: {
    type: 'CALC',
    code: 'total_units',
    label: '合計売上個数',
    expression: 'SUM(ch_units)',
    format: 'NUMBER',
    displayScale: '0',
    unit: '個',
    unitPosition: 'AFTER',
  },

  // ── チャネル別実績（テーブル）──
  results: {
    type: 'SUBTABLE',
    code: 'results',
    label: 'チャネル別実績',
    fields: {
      channel: {
        type: 'DROP_DOWN',
        code: 'channel',
        label: 'チャネル',
        options: {
          楽天: { label: '楽天', index: '0' },
          Amazon: { label: 'Amazon', index: '1' },
          自社サイト: { label: '自社サイト', index: '2' },
          TikTok: { label: 'TikTok', index: '3' },
          Qoo10: { label: 'Qoo10', index: '4' },
          BASE: { label: 'BASE', index: '5' },
        },
      },
      ch_sales: numberField('ch_sales', '売上', { unit: '円' }),
      ch_units: numberField('ch_units', '売上個数', { unit: '個' }),
      ch_access: numberField('ch_access', 'アクセス数', {}),
      ch_cvr: numberField('ch_cvr', '転換率', { unit: '%', displayScale: '2' }),
      ch_like: numberField('ch_like', 'いいね率', { unit: '%', displayScale: '2' }),
      ch_bulk: numberField('ch_bulk', 'まとめ買い率', { unit: '%', displayScale: '2' }),
    },
  },
};

// チャネルコード（マイグレーション等で共有）
export const CHANNELS = ['楽天', 'Amazon', '自社サイト', 'TikTok', 'Qoo10', 'BASE'];

function numberField(code, label, { unit, unitPosition = 'AFTER', displayScale } = {}) {
  const f = { type: 'NUMBER', code, label, digit: true };
  if (unit) {
    f.unit = unit;
    f.unitPosition = unitPosition;
  }
  if (displayScale) f.displayScale = displayScale;
  return f;
}
