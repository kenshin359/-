#!/usr/bin/env node
// ============================================================
//  朝礼レポート（Chatworkで「朝礼」と打つと売上・進捗を返す）
// ------------------------------------------------------------
//  仕組み:
//    朝の時間帯に数分おきにChatworkの部屋をのぞき、
//    「朝礼」という発言があって、まだ返事をしていなければ、
//    昨日までの売上と計画比の進捗（参謀レポート）を返します。
//
//  ・見る部屋: 売上グループ（CHATWORK_SALES_ROOM_ID / CHATWORK_ROOM_ID）
//  ・自分の返事には目印（📣 朝礼レポート）を入れ、二重返信を防ぐ
//  ・キントーンは読むだけ。書き込みは一切しません。
//
//  実行: node scripts/chorei.js          … 通常（返信まで行う）
//        node scripts/chorei.js --dry-run … 判定だけ（返信しない）
// ============================================================
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';
import { salesAppId } from '../lib/salesDetailWrite.js';
import { pushChatwork } from '../lib/chatwork.js';
import { todayISO } from '../lib/date.js';
import { yesterdayISO } from './shopifyImport.js';
import { loadDailyPlan, computeBrief, computePlanCompare, formatBrief } from './dailyBrief.js';

export const MARKER = '📣 朝礼レポート';
const isDry = process.argv.includes('--dry-run');

/** 「朝礼」のリクエストかどうか（[To:xxx]や記号を除いた本文で判定） */
export function isChoreiRequest(body) {
  const t = String(body ?? '')
    .replace(/\[To:\d+\][^\n]*?さん/g, '')
    .replace(/\[[^\]]*\]/g, '')   // [To:..][rp ..] などのタグを除去
    .replace(/[\s、。！!【】「」()（）]/g, '');
  if (!t) return false;
  if (t.includes(MARKER.replace('📣 ', ''))) return false; // 自分の返信は除外
  return t === '朝礼' || t === '朝礼お願いします' || t === '朝礼おねがいします';
}

/**
 * まだ返事をしていない「朝礼」があるか。
 * @param {object[]} messages Chatworkのメッセージ（古い→新しい順）
 * @returns {boolean}
 */
export function findPendingChorei(messages) {
  let pending = false;
  for (const m of messages ?? []) {
    const body = m.body ?? '';
    if (body.includes(MARKER)) pending = false;      // 返信済み
    else if (isChoreiRequest(body)) pending = true;  // 新しい依頼
  }
  return pending;
}

async function getMessages(roomId) {
  const token = optional('CHATWORK_API_TOKEN');
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages?force=1`, {
    headers: { 'X-ChatWorkToken': token },
  });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`Chatworkメッセージ取得に失敗: HTTP ${res.status}`);
  return res.json();
}

async function buildReport() {
  const dateISO = yesterdayISO(todayISO());
  const app = salesAppId();
  const plan = loadDailyPlan(dateISO);
  const target = Number(optional('SALES_TARGET_MONTHLY', '')) || plan?.monthly_target || null;

  const monthStart = `${dateISO.slice(0, 7)}-01`;
  const prevMonthStart = `${monthStart.slice(0, 5)}${String(Number(monthStart.slice(5, 7)) - 1 || 12).padStart(2, '0')}-01`;
  const readFrom = Number(monthStart.slice(5, 7)) === 1
    ? `${Number(monthStart.slice(0, 4)) - 1}-12-01`
    : prevMonthStart;

  const records = [];
  for (let offset = 0; ; offset += 100) {
    const q = encodeURIComponent(
      `report_date >= "${readFrom}" and report_date <= "${dateISO}" order by report_date asc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    records.push(...(r.records ?? []));
    if ((r.records ?? []).length < 100) break;
  }

  const brief = computeBrief(records, dateISO, target);
  if (!brief.hasData) return `${MARKER}\n${dateISO} の売上データがまだ取り込まれていません。取込後にもう一度「朝礼」と打ってください。`;

  const planCmp = computePlanCompare(records, dateISO, plan);
  const body = formatBrief(brief, dateISO, target, planCmp);
  return `${MARKER}（昨日 ${dateISO.slice(5).replace('-', '/')} まで）\n${body}`;
}

async function main() {
  const roomIds = [...new Set([optional('CHATWORK_SALES_ROOM_ID'), optional('CHATWORK_ROOM_ID')].filter(Boolean))];
  if (!roomIds.length || !optional('CHATWORK_API_TOKEN')) {
    throw new Error('CHATWORK_API_TOKEN と CHATWORK_SALES_ROOM_ID（またはCHATWORK_ROOM_ID）が必要です');
  }

  let report = null;
  for (const roomId of roomIds) {
    const messages = await getMessages(roomId);
    const pending = findPendingChorei(messages);
    console.log(`ルーム${roomId}: メッセージ${messages.length}件 / 朝礼待ち=${pending ? 'あり' : 'なし'}`);
    if (!pending) continue;
    if (isDry) { console.log('（--dry-run のため返信しません）'); continue; }
    report = report ?? (await buildReport());
    await pushChatwork(report, { roomId });
    console.log(`  → 朝礼レポートを返信しました`);
  }
  console.log('完了');
}

if (process.argv[1] && process.argv[1].endsWith('chorei.js')) {
  main().catch((e) => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
}
