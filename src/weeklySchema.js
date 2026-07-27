// 「SNS/LP週次報告（新）」アプリのフィールド定義。
// 売上日報アプリ（appSchema.js）と同じく、kintone「フィールド追加API」に渡す
// properties 形式（キー = フィールドコード）。

export const WEEKLY_FIELDS = {
  // ── チーム ──
  team: {
    type: 'DROP_DOWN',
    code: 'team',
    label: 'チーム',
    required: true,
    options: {
      SNS: { label: 'SNS', index: '0' },
      LP: { label: 'LP', index: '1' },
    },
  },

  // ── 対象期間 ──
  period_start: {
    type: 'DATE',
    code: 'period_start',
    label: '期間（開始）',
    required: true,
    defaultNowValue: false,
  },
  period_end: {
    type: 'DATE',
    code: 'period_end',
    label: '期間（終了）',
    defaultNowValue: false,
  },

  // ── 投稿数（SNS）──
  posts_total: numberField('posts_total', '合計投稿数', { unit: '投稿' }),

  // ── 本文（そのまま保持して検索・振り返りに使う）──
  summary: textArea('summary', '総括'),
  next_week: textArea('next_week', '来週予定'),
  mtg: textArea('mtg', 'MTG予定'),

  // ── アカウント別 投稿内訳（テーブル）──
  posts: {
    type: 'SUBTABLE',
    code: 'posts',
    label: 'アカウント別投稿内訳',
    fields: {
      account: { type: 'SINGLE_LINE_TEXT', code: 'account', label: 'アカウント' },
      count: { type: 'NUMBER', code: 'count', label: '投稿数', unit: '投稿', unitPosition: 'AFTER', digit: false },
    },
  },

  // ── 商品・カテゴリ別トピック（テーブル）──
  sections: {
    type: 'SUBTABLE',
    code: 'sections',
    label: '商品・カテゴリ別トピック',
    fields: {
      title: { type: 'SINGLE_LINE_TEXT', code: 'title', label: '項目' },
      done: { type: 'MULTI_LINE_TEXT', code: 'done', label: '実施内容' },
      next: { type: 'MULTI_LINE_TEXT', code: 'next', label: '来週予定' },
    },
  },
};

function numberField(code, label, { unit, unitPosition = 'AFTER', displayScale } = {}) {
  const f = { type: 'NUMBER', code, label, digit: true };
  if (unit) {
    f.unit = unit;
    f.unitPosition = unitPosition;
  }
  if (displayScale) f.displayScale = displayScale;
  return f;
}

function textArea(code, label) {
  return { type: 'MULTI_LINE_TEXT', code, label };
}
