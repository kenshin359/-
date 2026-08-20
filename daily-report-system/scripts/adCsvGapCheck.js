#!/usr/bin/env node
// ============================================================
//  広告CSVの「抜け」チェック → Chatwork通知
// ------------------------------------------------------------
//  毎朝KPI報告アプリの当日レコードを見て、毎日必須の
//  ブランド別広告CSV欄（リベティ: メタ/RPP/Amazon/TikTok、
//  O2: Google/メタ、ガジェティ: メタ）に添付が無いものを
//  Chatworkに知らせます。案件依頼・PRタイムズは「あった時
//  だけ」の欄なのでチェックしません。全部そろっていれば
//  何も送りません（静かな見張り番）。
//
//  実行: node scripts/adCsvGapCheck.js [--date=YYYY-MM-DD] [--dry-run]
// ============================================================
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const DRY = process.argv.includes('--dry-run');
const encodeDigits = (s) => String(s).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);

// 毎日必須の欄（コード → 表示名）
const REQUIRED = {
  ad_lib_meta: '【リベティ】メタ広告',
  ad_lib_rpp: '【リベティ】RPP',
  ad_lib_amazon: '【リベティ】Amazon広告',
  ad_lib_tiktok: '【リベティ】TikTok広告',
  ad_o2_google: '【O2】Google広告',
  ad_o2_meta: '【O2】メタ広告',
  ad_gad_meta: '【ガジェティ】メタ広告',
};

async function sendChatwork(body) {
  const token = optional('CHATWORK_API_TOKEN');
  const room = optional('CHATWORK_CHOREI_ROOM_ID') || '433161347';
  if (!token) {
    console.log('CHATWORK_API_TOKEN が未設定のため送信をスキップしました。');
    return;
  }
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${room}/messages`, {
    method: 'POST',
    headers: {
      'X-ChatWorkToken': token,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ body, self_unread: '0' }).toString(),
  });
  if (!res.ok) throw new Error(`Chatwork送信に失敗: ${res.status}`);
  console.log('Chatworkに通知しました（ルームIDは伏せます）。');
}

async function main() {
  const app = optional('KINTONE_KPI_APP_ID', '30');
  const base = (optional('KINTONE_BASE_URL') || '').replace(/\/$/, '');
  const todayJST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const date = arg('date', todayJST);
  const md = date.slice(5).replace('-', '/');

  const q = encodeURIComponent(`report_date = "${date}" limit 1`);
  const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
  const rec = (r.records ?? [])[0];

  let missing;
  let intro;
  if (!rec) {
    missing = Object.values(REQUIRED);
    intro = `${md}のKPI報告レコードがまだ作成されていません。レコード作成のうえ、下記のCSVを添付してください。`;
  } else {
    missing = Object.entries(REQUIRED)
      .filter(([code]) => !(rec[code]?.value ?? []).length)
      .map(([, label]) => label);
    intro = `${md}のKPI報告で、まだ添付されていない広告CSVがあります。`;
  }

  if (!missing.length) {
    console.log(`✅ ${date}: 毎日必須の広告CSVは全て添付済み。通知しません。`);
    return;
  }
  console.log(`⚠ ${date}: 未添付 ${encodeDigits(missing.length)}件を検知しました。`);

  const body =
    '[info][title]📎 広告CSVの抜けチェック（自動）[/title]' +
    `${intro}\n\n${missing.map((m) => `・${m}`).join('\n')}\n\n` +
    `添付はこちら → ${base}/k/${app}/\n` +
    '※それぞれ専用の欄（リベティ｜メタ広告CSV など）に入れてください。ファイル名の変更は不要です。\n' +
    '※案件依頼・PRタイムズは「あった時だけ」でOK（このチェックの対象外）。[/info]';

  if (DRY) {
    console.log('---dry-run: 送信せず本文（数字はA-J符号化）だけ表示---');
    console.log(encodeDigits(body));
    return;
  }
  await sendChatwork(body);
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
