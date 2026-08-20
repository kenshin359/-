// ============================================================
//  議事録アプリ  フィールド定義
// ------------------------------------------------------------
//  定例ミーティングなどの議事録を1回=1レコードで保存するアプリ。
//  要約・決定事項・未決事項・録音リンクをまとめて、
//  後から「あの件いつ決めたっけ？」をすぐ引けるようにします。
//  ★議事録の中身はこのリポジトリには置きません（実行時に登録）。
// ============================================================

export const APP_NAME = '議事録（ミーティング記録）';

export const FIELDS = {
  meeting_date: { type: 'DATE', code: 'meeting_date', label: '開催日', required: true },
  title: { type: 'SINGLE_LINE_TEXT', code: 'title', label: '会議名', required: true },
  attendees: { type: 'SINGLE_LINE_TEXT', code: 'attendees', label: '参加者' },
  summary: { type: 'MULTI_LINE_TEXT', code: 'summary', label: '要約（トピック別）' },
  decisions: { type: 'MULTI_LINE_TEXT', code: 'decisions', label: '決定事項・アクションアイテム' },
  pending: { type: 'MULTI_LINE_TEXT', code: 'pending', label: '未決事項・持ち越し' },
  link: { type: 'LINK', code: 'link', label: '録音・文字起こしリンク', protocol: 'WEB' },
  memo: { type: 'MULTI_LINE_TEXT', code: 'memo', label: '備考' },
};

export const VIEWS = {
  新しい順: {
    index: 0,
    type: 'LIST',
    name: '新しい順',
    fields: ['meeting_date', 'title', 'attendees', 'link'],
    sort: 'meeting_date desc',
  },
};
