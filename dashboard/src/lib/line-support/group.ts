import { closeCase, getCase, listOpenCases, touchCase } from './cases';
import { pushText, replyText } from './client';
import { GROUP_HELP, parseGroupCommand } from './groupCommands';
import { dismissPendingOfCase, findPendingByCase, markSent } from './inquiries';
import { clearStaffGroupId, getStaffGroupId, setStaffGroupId } from './settings';
import { saveReply } from './store';

export type GroupEvent = {
  type: string;
  replyToken?: string;
  source?: { type?: string; groupId?: string; roomId?: string; userId?: string };
  message?: { type?: string; text?: string };
};

function groupIdOf(ev: GroupEvent): string {
  return ev.source?.groupId || ev.source?.roomId || '';
}

const JOIN_MESSAGE = [
  'Libetee サポートBotです。招待ありがとうございます。',
  'このグループを「お客様からの要対応メッセージの通知先」として登録しました。',
  '',
  GROUP_HELP,
].join('\n');

/**
 * グループ・複数人トークでのイベント処理。
 * - join: 通知先として自動登録（環境変数 LINE_SUPPORT_STAFF_GROUP_ID があればそちらが優先）
 * - leave: 登録解除
 * - message: 登録済みグループからのコマンド（#番号 返信 / 完了 / 一覧 / ヘルプ）だけに反応。雑談には反応しない。
 */
export async function handleGroupEvent(ev: GroupEvent): Promise<void> {
  const gid = groupIdOf(ev);
  if (!gid) return;

  if (ev.type === 'join') {
    const current = await getStaffGroupId();
    const envFixed = Boolean((process.env.LINE_SUPPORT_STAFF_GROUP_ID || '').trim());
    if (!current || (!envFixed && current !== gid)) {
      if (!envFixed) await setStaffGroupId(gid);
    }
    const registered = (await getStaffGroupId()) === gid;
    if (ev.replyToken) {
      await replyText(
        ev.replyToken,
        registered
          ? JOIN_MESSAGE
          : '招待ありがとうございます。通知先は別のグループに固定されているため、このグループには通知しません。\n通知先をここにする場合は「スタッフ登録」と送ってください。',
      );
    }
    return;
  }

  if (ev.type === 'leave') {
    await clearStaffGroupId(gid);
    return;
  }

  if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.replyToken) return;
  const cmd = parseGroupCommand(ev.message.text ?? '');
  if (cmd.kind === 'none') return;

  if (cmd.kind === 'register') {
    if ((process.env.LINE_SUPPORT_STAFF_GROUP_ID || '').trim()) {
      await replyText(ev.replyToken, '通知先は環境変数 LINE_SUPPORT_STAFF_GROUP_ID で固定されています。変更する場合は Vercel の設定を変えてください。');
      return;
    }
    await setStaffGroupId(gid);
    await replyText(ev.replyToken, 'このグループを通知先として登録しました。\n\n' + GROUP_HELP);
    return;
  }

  // 以下は登録済みグループからのみ受け付ける（他のグループから勝手にお客様へ送れないように）
  const staff = await getStaffGroupId();
  if (staff !== gid) {
    await replyText(ev.replyToken, 'このグループは通知先として登録されていません。「スタッフ登録」と送ると登録できます。');
    return;
  }

  if (cmd.kind === 'help') {
    await replyText(ev.replyToken, GROUP_HELP);
    return;
  }

  if (cmd.kind === 'list') {
    const open = await listOpenCases(20);
    if (open.length === 0) {
      await replyText(ev.replyToken, '進行中の案件はありません。');
      return;
    }
    const lines = open.map((c) => `#${c.no}（${c.updatedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })}）\n　${c.lastUserText.slice(0, 60)}`);
    await replyText(ev.replyToken, `進行中の案件 ${open.length}件\n\n${lines.join('\n')}`);
    return;
  }

  if (cmd.kind === 'close') {
    const c = await getCase(cmd.no);
    if (!c) {
      await replyText(ev.replyToken, `#${cmd.no} は見つかりません。`);
      return;
    }
    if (c.status === 'done') {
      await replyText(ev.replyToken, `#${cmd.no} はすでに完了しています。`);
      return;
    }
    await closeCase(cmd.no);
    const dismissed = await dismissPendingOfCase(cmd.no);
    await replyText(
      ev.replyToken,
      `#${cmd.no} を完了にしました。このお客様へのAI自動返信を再開します。${dismissed ? `（未送信の回答案 ${dismissed}件は対応不要にしました）` : ''}`,
    );
    return;
  }

  if (cmd.kind === 'approve') {
    const c = await getCase(cmd.no);
    if (!c) {
      await replyText(ev.replyToken, `#${cmd.no} は見つかりません。「一覧」で進行中の案件を確認できます。`);
      return;
    }
    const pending = await findPendingByCase(cmd.no);
    if (!pending?.draft) {
      await replyText(ev.replyToken, `#${cmd.no} には送信できる回答案がありません。「#${cmd.no} 返信文」で本文を送ってください。`);
      return;
    }
    try {
      await pushText(c.lineUserId, pending.draft);
    } catch (e) {
      await replyText(ev.replyToken, `#${cmd.no} への送信に失敗しました: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      return;
    }
    await markSent(pending, pending.draft, 'staff-line');
    await saveReply(c.lineUserId, pending.draft, { needsHuman: false, reason: `スタッフ承認 #${c.no}`, topics: [] });
    await touchCase(c.no);
    await replyText(ev.replyToken, `#${c.no} のお客様にAIの回答案を送信しました。対応が終わったら「完了 #${c.no}」と送ってください。`);
    return;
  }

  if (cmd.kind === 'reply') {
    const c = await getCase(cmd.no);
    if (!c) {
      await replyText(ev.replyToken, `#${cmd.no} は見つかりません。「一覧」で進行中の案件を確認できます。`);
      return;
    }
    if (!cmd.text) {
      await replyText(ev.replyToken, `返信文が空です。「#${cmd.no} 返信文」の形で送ってください。`);
      return;
    }
    try {
      await pushText(c.lineUserId, cmd.text);
    } catch (e) {
      await replyText(ev.replyToken, `#${cmd.no} への送信に失敗しました: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      return;
    }
    await saveReply(c.lineUserId, cmd.text, { needsHuman: false, reason: `スタッフ返信 #${c.no}`, topics: [] });
    // 承認待ちの回答案があれば、書き換えて送ったものとして記録（修正データ）
    const pending = await findPendingByCase(c.no);
    if (pending) await markSent(pending, cmd.text, 'staff-line', { edited: true });
    await touchCase(c.no);
    const note = c.status === 'done' ? '（この案件は完了済みです。続けて対応する場合はそのまま返信できます）' : '';
    await replyText(ev.replyToken, `#${c.no} のお客様に送信しました。${note}`);
  }
}
