// /pro/line の画面データ型（サーバー→クライアント）。prisma の Date は ISO 文字列にして渡す。

export interface LineGroupView {
  groupId: string;
  name: string | null;
  teamCode: string | null;
  teamName: string | null;
  active: boolean;
  joinedAt: string;
  messageCount: number;
  lastMessageAt: string | null;
  openFollowUps: number;
}

export interface LineMessageView {
  id: string;
  groupId: string;
  displayName: string | null;
  kind: string;
  /** 管理職以上にのみ本文を渡す。それ以外は null */
  text: string | null;
  ts: string;
  extracted: { confidence?: string; title?: string; completion?: boolean; followUpId?: string } | null;
}

export interface FollowUpView {
  id: string;
  groupId: string | null;
  groupName: string | null;
  teamCode: string | null;
  title: string;
  assigneeName: string | null;
  due: string | null; // YYYY-MM-DD
  status: string; // open | done | dropped
  taskId: string | null;
  remindAt: string | null;
  remindedCount: number;
  lastRemindedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceText: string | null; // 管理職以上のみ
}

export interface ScheduledPostView {
  id: string;
  groupId: string;
  groupName: string | null;
  name: string;
  cron: string;
  template: string;
  body: string | null;
  active: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface AuditView {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
  userName: string | null;
}

export interface LineAdminData {
  configured: boolean;
  envNames: readonly string[];
  cronSecretConfigured: boolean;
  canManage: boolean; // manager 以上
  groups: LineGroupView[];
  messages: LineMessageView[];
  followUps: FollowUpView[];
  posts: ScheduledPostView[];
  audits: AuditView[];
  teamOptions: { code: string; name: string; kintoneLabel: string | null }[];
  taskTeams: string[];
  members: string[];
  tasksNotice: string | null;
  now: string;
}
