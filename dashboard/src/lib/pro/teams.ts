// 部署の初期定義（リベティ構成マインドマップ 2026-09-18 と Kintone タスク管理の「チーム」選択肢を対応付け）。
// DB の Team テーブルが空のときはこの定義を使い、管理画面で上書きできる。
export interface TeamDef {
  code: string;
  name: string;
  parentCode: string | null;
  kintoneLabels: string[]; // Kintone team ドロップダウンの表記（複数可）
  leader: string | null; // 担当者名（Kintone表記）
  members: string[];
  sortOrder: number;
}

export const TEAM_DEFS: TeamDef[] = [
  { code: 'exec', name: '経営', parentCode: null, kintoneLabels: ['経営'], leader: '北野', members: ['塚本', '北野'], sortOrder: 0 },
  { code: 'ceo_office', name: '社長室', parentCode: 'exec', kintoneLabels: ['社長室'], leader: '西岡', members: ['西岡', '淵田', 'ともや'], sortOrder: 1 },
  { code: 'ec', name: 'EC・物販', parentCode: 'exec', kintoneLabels: [], leader: '北野', members: [], sortOrder: 2 },
  { code: 'ads', name: '広告', parentCode: 'ec', kintoneLabels: ['広告'], leader: '角南', members: ['角南', '辰巳', '杉本', '山下'], sortOrder: 3 },
  { code: 'lp', name: 'LP', parentCode: 'ec', kintoneLabels: ['LP'], leader: '黒葛原', members: ['黒葛原', 'ミンジ', '久保', '三浦'], sortOrder: 4 },
  { code: 'sns', name: 'SNS', parentCode: 'ec', kintoneLabels: ['SNS'], leader: '倉内', members: ['倉内', '城谷', '内田', '桝田', '中谷'], sortOrder: 5 },
  { code: 'tiktok', name: 'TikTok', parentCode: 'ec', kintoneLabels: ['TikTok'], leader: '山近', members: ['山近', '山本'], sortOrder: 6 },
  { code: 'cs', name: 'CS・物流', parentCode: 'ec', kintoneLabels: ['CS'], leader: '笹本', members: ['笹本', '村田', '関本'], sortOrder: 7 },
  { code: 'product', name: '商品開発・仕入れ', parentCode: 'ec', kintoneLabels: [], leader: '北野', members: [], sortOrder: 8 },
  { code: 'o2', name: 'O2ジム', parentCode: 'exec', kintoneLabels: ['O2'], leader: '阪本', members: ['阪本', '山本稔', '辰巳'], sortOrder: 9 },
  { code: 'overseas', name: '海外事業（韓国・中国）', parentCode: 'exec', kintoneLabels: ['韓国', 'ユニONA'], leader: 'ここあ', members: ['ここあ', 'ソンチャン', '杉本'], sortOrder: 10 },
  { code: 'hr', name: '人事・管理', parentCode: 'exec', kintoneLabels: ['人事・管理'], leader: '阪本', members: ['阪本'], sortOrder: 11 },
  { code: 'finance', name: '経理・財務', parentCode: 'exec', kintoneLabels: [], leader: '北野', members: [], sortOrder: 12 },
];

export function teamByKintoneLabel(label: string): TeamDef | undefined {
  return TEAM_DEFS.find((t) => t.kintoneLabels.includes(label));
}

export function teamByCode(code: string): TeamDef | undefined {
  return TEAM_DEFS.find((t) => t.code === code);
}

export function teamOfMember(name: string): TeamDef | undefined {
  return TEAM_DEFS.find((t) => t.members.includes(name));
}
