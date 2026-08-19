// ============================================================
//  ログイン情報（社内アカウント一覧）アプリ  フィールド定義
// ------------------------------------------------------------
//  新人さんに「どのサービスに・どこから・何のためにログインするか」を
//  1か所で教えられるようにするアプリ。
//  ★ログインIDやパスワードはこのリポジトリには一切置きません。
//    キントーンの画面から直接記入してもらいます。
//  ★パスワードは本体を書かず「保管場所」や「◯◯さんに確認」と
//    書く運用を推奨（フィールド名にも明記）。
// ============================================================

export const APP_NAME = 'ログイン情報（社内アカウント一覧）';

const drop = (code, label, options) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
});

export const FIELDS = {
  category: drop('category', '区分', ['EC・モール', '広告', '社内ツール', 'その他']),
  service: {
    type: 'SINGLE_LINE_TEXT',
    code: 'service',
    label: 'サービス名',
    required: true,
    unique: true,
  },
  url: { type: 'LINK', code: 'url', label: 'ログインページURL', protocol: 'WEB' },
  login_id: { type: 'SINGLE_LINE_TEXT', code: 'login_id', label: 'ログインID' },
  password_note: {
    type: 'SINGLE_LINE_TEXT',
    code: 'password_note',
    label: 'パスワード（※本体は書かず、保管場所や確認先を書く）',
  },
  owner: { type: 'SINGLE_LINE_TEXT', code: 'owner', label: '管理担当者' },
  share_newcomer: drop('share_newcomer', '新人への共有', ['新人に共有', '管理者のみ']),
  memo: { type: 'MULTI_LINE_TEXT', code: 'memo', label: '新人向けメモ（用途・最初にやること）' },
};

export const VIEWS = {
  新人向け一覧: {
    index: 0,
    type: 'LIST',
    name: '新人向け一覧',
    fields: ['category', 'service', 'url', 'login_id', 'owner', 'memo'],
    filterCond: 'share_newcomer in ("新人に共有")',
    sort: 'category asc',
  },
  全アカウント一覧: {
    index: 1,
    type: 'LIST',
    name: '全アカウント一覧',
    fields: ['category', 'service', 'url', 'login_id', 'password_note', 'owner', 'share_newcomer'],
    sort: 'category asc',
  },
};
