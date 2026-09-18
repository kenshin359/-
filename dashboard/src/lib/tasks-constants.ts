// タスクの選択肢（クライアントでも使う。prisma に依存しない）
export const TEAMS = ['CS', '広告', 'LP', 'SNS', 'TikTok', 'O2', '韓国', 'ユニONA', '社長室', '人事・管理', '経営'];
export const MEMBERS = [
  '塚本', '北野', '笹本', '村田', '関本', '角南', 'ともや', '黒葛原', 'ミンジ', '久保', '三浦',
  '倉内', '内田', '桝田', '中谷', '山本', '山近', '山本稔', '辰巳', 'ここあ', 'ソンチャン',
  '杉本', 'やまりょう', '小西', '西岡', '淵田', '阪本', 'その他',
];
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const IMPACTS = ['◎ 売上に直結', '○ 間接（計測・基盤）', '△ 体制づくり'] as const;
export const STATUSES = ['未着手', '進行中', '確認待ち', '完了'] as const;
export type TaskStatus = (typeof STATUSES)[number];

