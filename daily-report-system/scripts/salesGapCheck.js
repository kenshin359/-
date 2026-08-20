#!/usr/bin/env node
// ============================================================
//  売上の差額チェック（手入力 vs 自動集計）
// ------------------------------------------------------------
//  売上・転換率報告アプリ（手入力・読むだけ）と
//  売上明細アプリ（自動取込）の日次売上を媒体別に突合し、
//  差がしきい値（既定±1万円）を超えた日だけChatworkに知らせます。
//  差が無ければ何も送りません（静かな見張り番）。
//
//  ログには金額を出しません（公開リポジトリのため）。
//  実行: node scripts/salesGapCheck.js --days=3 [--dry-run]
// ============================================================
import { required, optional } from '../lib/env.js';
import { call } from '../lib/intake.js';
import { fetchSalesApp, extractDailyRows } from '../lib/kintoneSalesDaily.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const DRY = process.argv.includes('--dry-run');
const encodeDigits = (s) => String(s).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);
const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP');
const sign = (n) => (n > 0 ? '+' : '') + Number(n).toLocaleString('ja-JP');

// 売上明細（自動取込）から日別×媒体の売上を集計
async function fetchAutoDaily(app, from) {
  const days = {};
  for (let offset = 0; ; offset += 100) {
    const q = encodeURIComponent(
      `report_date >= "${from}" order by report_date asc limit 100 offset ${offset}`
    );
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    for (const rec of r.records ?? []) {
      const d = rec.report_date?.value;
      if (!d) continue;
      for (const row of rec.detail?.value ?? []) {
        const v = row.value ?? {};
        const ch = v.s_channel?.value ?? '';
        const amt = Number(v.s_amount?.value) || 0;
        const day = (days[d] ??= { rakuten: 0, amazon: 0, own: 0 });
        if (ch === '楽天') day.rakuten += amt;
        else if (ch === 'Amazon') day.amazon += amt;
        else if (ch === '自社サイト') day.own += amt;
      }
    }
    if ((r.records ?? []).length < 100) break;
  }
  return days;
}

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
  const daysBack = Number(arg('days', '3'));
  const threshold = Number(arg('threshold', '10000'));

  const since = new Date(Date.now() + 9 * 3600 * 1000);
  since.setUTCDate(since.getUTCDate() - daysBack);
  const sinceISO = since.toISOString().slice(0, 10);

  // 手入力（売上・転換率報告）
  const manualRows = extractDailyRows(await fetchSalesApp()).filter((r) => r.date >= sinceISO);
  // 自動（売上明細）
  const detailApp = required('KINTONE_SALES_DETAIL_APP_ID');
  const auto = await fetchAutoDaily(detailApp, sinceISO);

  const CH = [
    ['rakuten', '楽天'],
    ['amazon', 'Amazon'],
    ['own', '自社サイト'],
  ];
  const hits = [];
  for (const m of manualRows) {
    const a = auto[m.date];
    if (!a) continue; // 自動側が未取込の日は比較しない
    for (const [key, label] of CH) {
      const mv = Number(m.sales?.[key]);
      if (!Number.isFinite(mv) || mv === 0) continue; // 手入力が未記入の媒体は比較しない
      const diff = mv - (a[key] ?? 0);
      if (Math.abs(diff) > threshold) {
        hits.push({ date: m.date, label, manual: mv, auto: a[key] ?? 0, diff });
      }
    }
  }

  console.log(`対象: ${manualRows.length}日分（${sinceISO}以降）／しきい値 ±${encodeDigits(threshold)}円`);
  if (!hits.length) {
    console.log('✅ しきい値を超える差はありませんでした。通知しません。');
    return;
  }
  console.log(`⚠ 差分 ${encodeDigits(hits.length)}件を検知しました。`);

  const lines = hits.map((h) => {
    const md = h.date.slice(5).replace('-', '/');
    const hint = h.diff > 0
      ? '手入力の後にキャンセル・返品が出た可能性が高いです（手入力の修正は不要）'
      : '自動側にあるのに手入力に入っていない売上があります（集計範囲の確認をおすすめします）';
    return `${md} ${h.label}: 手入力 ${yen(h.manual)} ／ 自動 ${yen(h.auto)}（差 ${sign(h.diff)}円）\n　→ ${hint}`;
  });
  const body =
    '[info][title]📊 売上報告の差額チェック（自動）[/title]' +
    `手入力の「売上・転換率報告」と自動集計を突き合わせた結果、差の大きい日がありました。\n\n${lines.join('\n')}\n\n` +
    '※月次の締め・目標進捗は自動集計の数字をご利用ください。この通知への返信は不要です。[/info]';

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
