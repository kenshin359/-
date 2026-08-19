// ============================================================
//  会社情報（専門家・取引先連絡先）アプリ  フィールド定義
// ------------------------------------------------------------
//  弁護士・社労士・税理士・銀行など、会社の重要連絡先を
//  1か所にまとめるアプリ。スタッフが「誰に連絡すればいいか」を
//  すぐ引けるようにします。
//  ★連絡先の中身はこのリポジトリには置きません（実行時に登録）。
// ============================================================

export const APP_NAME = '会社情報（専門家・取引先）';

const drop = (code, label, options) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
});

export const FIELDS = {
  category: drop('category', '区分', ['弁護士', '社労士', '税理士', '銀行', '保険', '不動産', 'その他']),
  name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'name',
    label: '名前',
    required: true,
  },
  office: { type: 'SINGLE_LINE_TEXT', code: 'office', label: '事務所名・会社名' },
  phone: { type: 'SINGLE_LINE_TEXT', code: 'phone', label: '電話番号' },
  email: { type: 'SINGLE_LINE_TEXT', code: 'email', label: 'メールアドレス' },
  address: { type: 'SINGLE_LINE_TEXT', code: 'address', label: '住所' },
  memo: { type: 'MULTI_LINE_TEXT', code: 'memo', label: '備考（連絡時のルールなど）' },
};

export const VIEWS = {
  連絡先一覧: {
    index: 0,
    type: 'LIST',
    name: '連絡先一覧',
    fields: ['category', 'name', 'office', 'phone', 'email', 'memo'],
    sort: 'category asc',
  },
};
