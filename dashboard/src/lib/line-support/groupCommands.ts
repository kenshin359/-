/**
 * スタッフグループで使えるコマンドの解釈（純粋関数・テスト対象）。
 *
 *   #12 送信          → 案件12のAI回答案をそのままお客様へ送る（承認）
 *   #12 返信文        → 案件12のお客様へ返信文を送る（回答案の書き換え）
 *   完了 #12 / #12 完了 → 案件12を完了（AI自動返信を再開）
 *   一覧              → 進行中の案件一覧
 *   スタッフ登録       → このグループを通知先として登録し直す
 *   ヘルプ            → 使い方
 */
export type GroupCommand =
  | { kind: 'approve'; no: number }
  | { kind: 'reply'; no: number; text: string }
  | { kind: 'close'; no: number }
  | { kind: 'list' }
  | { kind: 'register' }
  | { kind: 'help' }
  | { kind: 'none' };

const NUM = '[0-9０-９]+';
const toHalf = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

export function parseGroupCommand(raw: string): GroupCommand {
  const text = String(raw ?? '').trim().replace(/[＃]/g, '#');
  if (!text) return { kind: 'none' };

  let m = text.match(new RegExp(`^完了\\s*#?(${NUM})\\s*$`)) || text.match(new RegExp(`^#(${NUM})\\s*完了\\s*$`));
  if (m) return { kind: 'close', no: Number(toHalf(m[1])) };

  m = text.match(new RegExp(`^#(${NUM})\\s*(?:送信|承認|OK|ok)\\s*$`));
  if (m) return { kind: 'approve', no: Number(toHalf(m[1])) };

  m = text.match(new RegExp(`^#(${NUM})[\\s　:：]+([\\s\\S]+)$`));
  if (m) return { kind: 'reply', no: Number(toHalf(m[1])), text: m[2].trim() };

  if (/^(一覧|案件一覧|未対応|要対応一覧?)$/.test(text)) return { kind: 'list' };
  if (/^(スタッフ登録|通知先登録|ここに通知)$/.test(text)) return { kind: 'register' };
  if (/^(ヘルプ|help|使い方)$/i.test(text)) return { kind: 'help' };
  return { kind: 'none' };
}

export const GROUP_HELP = [
  'Libetee サポートBot（スタッフ用）の使い方',
  '',
  '・お客様からのメッセージとAIの回答案が「#番号」付きでこのグループに届きます',
  '・回答案をそのまま送る: 「#番号 送信」',
  '・書き換えて送る: 「#番号 返信文」（例: #12 ご注文番号を確認しました。明日発送いたします）',
  '・対応を終える: 「完了 #番号」（AIの自動返信が再開します）',
  '・進行中の案件を見る: 「一覧」',
  '・通知先をこのグループにする: 「スタッフ登録」',
].join('\n');
