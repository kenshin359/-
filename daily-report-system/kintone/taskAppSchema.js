// ============================================================
//  業務タスクアプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = タスク1件。カレンダー可視化ツールと同じ項目。
//  フィールドコードは lib/taskData.js の FIELD と一致させること。
// ============================================================

export const APP_NAME = '業務タスク';

// チーム / 種別 の選択肢をマスタから生成
import { TEAMS, CATEGORIES } from '../lib/taskData.js';

function options(list) {
  const o = {};
  list.forEach((item, i) => {
    const name = item.name || item;
    o[name] = { label: name, index: String(i) };
  });
  return o;
}

export const FIELDS = {
  task_title: {
    type: 'SINGLE_LINE_TEXT', code: 'task_title', label: 'タスク名', required: true,
  },
  assignee: {
    // 担当者は名前（文字列）。kintoneのユーザー選択にしたい場合は USER_SELECT に変更可。
    type: 'SINGLE_LINE_TEXT', code: 'assignee', label: '担当者', required: true,
  },
  team: {
    type: 'DROP_DOWN', code: 'team', label: 'チーム', required: true,
    options: options(TEAMS),
  },
  category: {
    type: 'DROP_DOWN', code: 'category', label: '種別', required: false,
    defaultValue: '資料作成',
    options: options(CATEGORIES),
  },
  priority: {
    type: 'DROP_DOWN', code: 'priority', label: '優先度', required: false,
    defaultValue: '中',
    options: { '高': { label: '高', index: '0' }, '中': { label: '中', index: '1' }, '低': { label: '低', index: '2' } },
  },
  status: {
    type: 'DROP_DOWN', code: 'status', label: 'ステータス', required: true,
    defaultValue: '未着手',
    options: {
      '未着手': { label: '未着手', index: '0' },
      '進行中': { label: '進行中', index: '1' },
      '完了': { label: '完了', index: '2' },
      '遅延': { label: '遅延', index: '3' },
    },
  },
  due_date: {
    type: 'DATE', code: 'due_date', label: '期日', required: true, defaultNowValue: false,
  },
};
