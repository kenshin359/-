import { describe, expect, it } from 'vitest';
import { TEAM_DEFS, teamByKintoneLabel, teamOfMember } from '../teams';

// Kintone タスク管理(38) の「チーム」選択肢（daily-report-system/kintone/taskBoardSchema.js の TEAMS と同じ並び）。
// 変更があればここも更新する（紐付け B5: 部署 ↔ Kintone team 選択肢）
const KINTONE_TEAMS = ['CS', '広告', 'LP', 'SNS', 'TikTok', 'O2', '韓国', 'ユニONA', '社長室', '人事・管理', '経営'];

describe('部署 ↔ Kintone チーム選択肢の対応（紐付け B5）', () => {
  it('Kintone の全チーム選択肢がいずれかの部署に対応する', () => {
    const missing = KINTONE_TEAMS.filter((t) => !teamByKintoneLabel(t));
    expect(missing).toEqual([]);
  });
  it('部署コードは重複しない・親コードは存在する', () => {
    const codes = TEAM_DEFS.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const t of TEAM_DEFS) if (t.parentCode) expect(codes).toContain(t.parentCode);
  });
  it('責任者は各部署のメンバーに含まれる（空のチームを除く）', () => {
    for (const t of TEAM_DEFS) if (t.leader && t.members.length) expect(t.members).toContain(t.leader);
  });
  it('主要メンバーの所属が引ける', () => {
    expect(teamOfMember('角南')?.code).toBe('ads');
    expect(teamOfMember('倉内')?.code).toBe('sns');
    expect(teamOfMember('笹本')?.code).toBe('cs');
  });
});
