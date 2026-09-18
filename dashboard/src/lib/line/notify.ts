import { pushText } from './client';

/**
 * 要対応の会話をスタッフに知らせる。
 * 送り先は設定があるものすべて（LINE_STAFF_GROUP_ID への push / Chatwork）。どちらも無ければ何もしない。
 * 通知の失敗でお客様への返信を止めないよう、呼び出し側は await しつつ例外は握りつぶす。
 */
export type StaffNotice = {
  lineUserId: string;
  userText: string;
  reply: string;
  reason: string;
};

export function formatStaffNotice(n: StaffNotice): string {
  return [
    '【LINE要対応】お客様への確認・返信をお願いします',
    `理由: ${n.reason || '（AI判断）'}`,
    `ユーザーID: ${n.lineUserId}`,
    '',
    '▼お客様のメッセージ',
    n.userText,
    '',
    '▼AIが送った一次回答',
    n.reply,
    '',
    '※LINE公式アカウントマネージャーのチャット画面から続きを返信できます。',
  ].join('\n');
}

export async function notifyStaff(n: StaffNotice): Promise<{ line: boolean; chatwork: boolean }> {
  const text = formatStaffNotice(n);
  const result = { line: false, chatwork: false };

  const staffGroup = (process.env.LINE_STAFF_GROUP_ID || '').trim();
  if (staffGroup) {
    try {
      await pushText(staffGroup, text);
      result.line = true;
    } catch (e) {
      console.error('[line-ai] スタッフLINE通知失敗:', e instanceof Error ? e.message : e);
    }
  }

  const cwToken = (process.env.CHATWORK_API_TOKEN || '').trim();
  const cwRoom = (process.env.CHATWORK_CS_ROOM_ID || process.env.CHATWORK_ROOM_ID || '').trim();
  if (cwToken && cwRoom) {
    try {
      const body = `[info][title]LINE要対応[/title]${text}[/info]`;
      const res = await fetch(`https://api.chatwork.com/v2/rooms/${cwRoom}/messages`, {
        method: 'POST',
        headers: { 'X-ChatWorkToken': cwToken, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ body }).toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      result.chatwork = true;
    } catch (e) {
      console.error('[line-ai] Chatwork通知失敗:', e instanceof Error ? e.message : e);
    }
  }
  return result;
}
