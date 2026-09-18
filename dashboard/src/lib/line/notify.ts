import { pushText } from './client';
import { getStaffGroupId } from './settings';

/**
 * 要対応の会話をスタッフに知らせる。
 * 送り先は設定があるものすべて（スタッフLINEグループへの push / Chatwork）。どちらも無ければ何もしない。
 * スタッフグループは、環境変数 LINE_STAFF_GROUP_ID か、公式アカウントをグループに招待したときの自動登録。
 * 通知の失敗でお客様への返信を止めないよう、例外は内部で握りつぶす。
 */
export type StaffNotice = {
  caseNo: number | null;
  lineUserId: string;
  userText: string;
  /** AIの一次回答。進行中案件への追加メッセージ（AI返信なし）のときは null */
  reply: string | null;
  reason: string;
  /** 同じ案件への追加メッセージか（新規通知か） */
  followUp?: boolean;
};

export function formatStaffNotice(n: StaffNotice): string {
  const tag = n.caseNo != null ? `#${n.caseNo}` : '';
  const lines = [
    n.followUp ? `【LINE ${tag} 追加メッセージ】お客様から続きが届きました` : `【LINE要対応 ${tag}】お客様への確認・返信をお願いします`,
  ];
  if (!n.followUp) lines.push(`理由: ${n.reason || '（AI判断）'}`);
  lines.push('', '▼お客様のメッセージ', n.userText);
  if (n.reply) lines.push('', '▼AIが送った一次回答', n.reply);
  lines.push('');
  if (n.caseNo != null) {
    lines.push(`▼返信するには、このグループに「${tag} 返信文」と送ってください`, `　対応が終わったら「完了 ${tag}」`);
  } else {
    lines.push('※LINE公式アカウントマネージャーのチャット画面から返信できます。');
  }
  return lines.join('\n');
}

export async function notifyStaff(n: StaffNotice): Promise<{ line: boolean; chatwork: boolean }> {
  const text = formatStaffNotice(n);
  const result = { line: false, chatwork: false };

  const staffGroup = await getStaffGroupId();
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
