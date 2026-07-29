// ============================================================
//  日次ダイジェスト（その日の全員分を1通にまとめて通知）
// ------------------------------------------------------------
//  提出のたびに飛ぶ個別通知とは別に、1日1回
//  「全員分をまとめた1通」を送ります。未提出者も分かります。
//
//  実行:
//    npm run digest                    … 今日の分
//    npm run digest -- --date=2026-07-29
//    npm run digest -- --dry-run       … 送らずに内容だけ表示
//
//  未提出者の判定:
//    「直近14日間に1回でも提出した人」を対象者とみなし、
//    その日に提出が無い人を未提出として挙げます。
//    名簿を手で管理しなくても済むようにしています。
//
//  ※ Kintone は読むだけ。一切変更しません。
// ============================================================
import { fetchAllDailyReportRecords } from '../lib/kintone.js';
import { extractImageReports, filterByDate, normalizeName } from '../lib/extractImages.js';
import { downloadFileAsBase64, toMediaType } from '../lib/kintoneFile.js';
import { summarizeReportImage } from '../lib/claude.js';
import { notify, describeResults, resolveChannels } from '../lib/notify.js';
import { resolveTargetDate } from '../lib/date.js';
import { optional } from '../lib/env.js';

// 対象者を割り出す期間（日数）
const ROSTER_DAYS = 14;

/** 直近N日に提出実績のある人を「対象者」として拾う */
function buildRoster(allReports, dateISO) {
  const target = new Date(dateISO + 'T00:00:00Z').getTime();
  const from = target - ROSTER_DAYS * 24 * 60 * 60 * 1000;

  const roster = new Map(); // 正規化名 → 表示名（最後に見た表記）
  for (const r of allReports) {
    if (!r.date || !r.reporter) continue;
    const t = new Date(r.date + 'T00:00:00Z').getTime();
    if (t >= from && t <= target) roster.set(normalizeName(r.reporter), r.reporter);
  }
  return roster;
}

async function main() {
  const dateISO = resolveTargetDate();
  const isDry = process.argv.includes('--dry-run');

  console.log(`${dateISO} の日次ダイジェストを作成します…`);
  const records = await fetchAllDailyReportRecords();
  const all = extractImageReports(records);
  const today = filterByDate(all, dateISO);

  console.log(`  提出: ${today.length} 件`);

  // 対象者と未提出者を割り出す
  const roster = buildRoster(all, dateISO);
  const submitted = new Set(today.map((r) => normalizeName(r.reporter)).filter(Boolean));
  const missing = [...roster.entries()]
    .filter(([norm]) => !submitted.has(norm))
    .map(([, display]) => display);

  // 提出0件でも「誰も出していない」ことを知らせる価値がある
  if (today.length === 0) {
    const text =
      `📊 Libetee 日報まとめ（${dateISO}）\n\n` +
      `本日の提出はありません。\n\n` +
      (missing.length ? `【未提出】\n${missing.map((n) => `・${n}さん`).join('\n')}\n\n` : '') +
      `詳細はKintoneをご確認ください。`;
    if (isDry) console.log('\n' + text);
    else console.log(describeResults((await notify(text)).results));
    return;
  }

  const hasClaude = !!optional('ANTHROPIC_API_KEY');
  if (!hasClaude) console.log('  ⚠️ ANTHROPIC_API_KEY 未設定のため、氏名のみのまとめになります。');

  // 1人ずつ画像を読んで要約する
  const lines = [`📊 Libetee 日報まとめ（${dateISO}）`, '', `提出 ${today.length}件 / 対象 ${roster.size}名`, ''];
  const urgentPeople = [];

  for (const r of today) {
    const who = r.reporter ?? '（氏名不明）';
    const team = r.team ? `（${r.team}）` : '';
    let summary = null;

    if (hasClaude && r.files[0]) {
      try {
        const { base64 } = await downloadFileAsBase64(r.files[0].key);
        summary = await summarizeReportImage({
          base64,
          mediaType: toMediaType(r.files[0].type),
          reporter: r.reporter,
          team: r.team,
          date: r.date,
        });
      } catch (e) {
        console.warn(`  ⚠️ ${who} の要約に失敗: ${e.message}`);
      }
    }

    const mark = summary?.urgent ? '🚨 ' : '';
    lines.push(`${mark}■ ${who}さん${team}`);
    if (summary) {
      lines.push(`  ${summary.summary || '情報不足'}`);
      if (summary.urgent && summary.urgent_reason) {
        lines.push(`  ⚠️ ${summary.urgent_reason}`);
        urgentPeople.push(who);
      }
    } else {
      lines.push('  （提出あり・内容の自動要約は未設定）');
    }
    lines.push('');
    console.log(`  ${mark}${who}: ${summary?.summary ?? '(要約なし)'}`);
  }

  // 未提出者
  if (missing.length) {
    lines.push('【未提出】', ...missing.map((n) => `・${n}さん`), '');
    console.log(`  未提出: ${missing.join('・')}`);
  } else {
    lines.push('【未提出】なし（全員提出済み）', '');
  }

  lines.push('詳細はKintoneをご確認ください。');
  const text = lines.join('\n');

  if (isDry) {
    console.log('\n--- [dry-run] 送信内容 ---\n' + text);
    return;
  }

  const channels = resolveChannels();
  console.log(`\n通知先: ${channels.join(' + ') || '（未設定）'}`);
  const { results } = await notify(text, { urgent: urgentPeople.length > 0 });
  console.log(describeResults(results));
}

main().catch((e) => {
  console.error('ダイジェスト エラー:', e.message);
  process.exit(1);
});
