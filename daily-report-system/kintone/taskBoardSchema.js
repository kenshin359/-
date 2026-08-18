// ============================================================
//  タスク管理（チーム進捗）アプリ  フィールド定義
// ------------------------------------------------------------
//  Excelの「デイリー進捗ボード」＋「柳井管理ボード」を統合。
//  1タスク＝1レコード。リーダーは毎朝「状態」だけ更新すればOK。
//  日々の一言は朝礼のChatwork報告のまま（二度手間なし）。
//
//  柳井ルール:
//   ・期限と「完了の定義（数字）」のないタスクは登録禁止
//   ・撤退・判断基準を先に書く
// ============================================================

export const APP_NAME = 'タスク管理（チーム進捗）';

const drop = (code, label, options, defaultValue) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
  ...(defaultValue ? { defaultValue } : {}),
});

export const TEAMS = ['CS', '広告', 'LP', 'SNS', 'TikTok', 'O2', '韓国', 'ユニONA', '社長室', '人事・管理', '経営'];
export const MEMBERS = [
  '塚本', '北野', '笹本', '村田', '関本', '角南', 'ともや', '黒葛原', 'ミンジ', '久保', '三浦',
  '倉内', '内田', '桝田', '中谷', '山本', '山近', '山本稔', '辰巳', 'ここあ', 'ソンチャン',
  '杉本', 'やまりょう', '小西', '西岡', '淵田', '阪本', 'その他',
];

export const FIELDS = {
  team: drop('team', 'チーム', TEAMS, undefined),
  tantou: drop('tantou', '担当者', MEMBERS, undefined),
  task_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'task_name',
    label: 'タスク名',
    required: true,
  },
  done_def: {
    type: 'SINGLE_LINE_TEXT',
    code: 'done_def',
    label: '完了の定義（数字で。"報告した"は完了ではない）',
  },
  priority: drop('priority', '優先度（P1が終わるまでP2に着手しない）', ['P1', 'P2', 'P3', 'P4'], 'P2'),
  impact: drop('impact', '売上直結度', ['◎ 売上に直結', '○ 間接（計測・基盤）', '△ 体制づくり'], '○ 間接（計測・基盤）'),
  due: { type: 'DATE', code: 'due', label: '期限' },
  status: drop('status', '状態（毎朝ここだけ更新）', ['未着手', '進行中', '確認待ち', '完了'], '未着手'),
  yanai: {
    type: 'SINGLE_LINE_TEXT',
    code: 'yanai',
    label: '柳井基準（撤退・判断ライン）',
  },
  memo: { type: 'MULTI_LINE_TEXT', code: 'memo', label: '備考（任意。日々の一言は朝礼で）' },
};

export const VIEWS = {
  '進行中（チーム別）': {
    index: 0,
    type: 'LIST',
    name: '進行中（チーム別）',
    fields: ['team', 'tantou', 'task_name', 'priority', 'impact', 'due', 'status'],
    filterCond: 'status not in ("完了")',
    sort: 'team asc, priority asc',
  },
  '⚠ 期限超過': {
    index: 1,
    type: 'LIST',
    name: '⚠ 期限超過',
    fields: ['due', 'team', 'tantou', 'task_name', 'priority', 'status'],
    filterCond: 'due < TODAY() and status not in ("完了")',
    sort: 'due asc',
  },
  'P1だけ': {
    index: 2,
    type: 'LIST',
    name: 'P1だけ',
    fields: ['team', 'tantou', 'task_name', 'done_def', 'due', 'status'],
    filterCond: 'priority in ("P1") and status not in ("完了")',
    sort: 'due asc',
  },
  '今月完了した仕事': {
    index: 3,
    type: 'LIST',
    name: '今月完了した仕事',
    fields: ['team', 'tantou', 'task_name', 'due'],
    filterCond: 'status in ("完了")',
    sort: 'due desc',
  },
};
