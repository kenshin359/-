#!/usr/bin/env node
// ============================================================
//  スペースの確認＆ジャンル別アプリリンク集の書き込み
// ------------------------------------------------------------
//  --mode=list  : スペースID 1〜30 を調べて、存在するスペースの
//                 ID・名前を表示します（読むだけ）
//  --mode=write : スペース名に応じて、最初のスレッド本文に
//                 ジャンル別のアプリリンク集を書き込みます
//                 （売上→売上・ECメニュー、案件→案件メニュー、
//                   会社→会社情報メニュー）
//  実行: node scripts/spaceMenu.js --mode=list
// ============================================================
import { optional } from '../lib/env.js';
import { call } from '../lib/intake.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const base = () => (optional('KINTONE_BASE_URL') || '').replace(/\/$/, '');

function link(app, label) {
  return `<a href="${base()}/k/${app}/">${label}</a>`;
}

// ジャンル別メニュー（キーワードでスペース名と対応づけ）
function menus() {
  const B = (s) => `<b>${s}</b>`;
  return [
    {
      match: /売上|EC/,
      title: '📊 売上・EC アプリの入り口',
      lines: [
        `${link(39, '📰 リベティ・デイリーニュース')}　🤖 毎朝11:10に自動更新`,
        `${link(29, '💰 売上明細')}　🤖 毎朝7時台に自動取込`,
        `${link(30, '📎 毎朝KPI報告・広告CSV添付')}　✍ 毎日：ブランド別の欄にCSVを添付`,
        `${link(42, '💸 広告費記載／全て')}　✍ 毎日：金額の記録（3ブランド）`,
        `${link(35, '📦 在庫報告 CS出荷後')}　✍ 毎日：退勤前に在庫データ`,
        `${link(38, '✅ タスク管理 チーム進捗')}　✍ 毎朝：状態だけ更新`,
        `${link(7, '📈 売上・転換率報告')}　✍ 毎日：アクセス・転換率`,
        `${link(6, '📝 日報')}　✍ 毎日`,
        `${link(33, '🏋️ O2 KPI管理')}　✍ 毎日（O2チーム）`,
      ],
    },
    {
      match: /案件|クリエイター/,
      title: '🤝 案件・クリエイター アプリの入り口',
      lines: [
        `${link(32, '🎬 案件報告（クリエイター・契約管理）')}　✍ 随時`,
      ],
    },
    {
      match: /会社|情報|管理/,
      title: '🗂 会社の情報・管理 アプリの入り口',
      lines: [
        `${link(44, '📅 会社カレンダー（統合）')}　✍ 予定はここへ`,
        `${link(43, '📋 議事録')}　🤖 会議後に自動作成`,
        `${link(40, '📒 会社名簿（社員・顧客・専門家）')}　✍ 随時`,
        `${link(41, '🔑 ログイン情報')}　✍ 新人はまずここ`,
        `${link(20, '💻 会社端末管理')}　✍ 随時`,
        `${link(22, '📐 寸法・FBA梱包情報')}　参照用`,
      ],
    },
  ].map((m) => ({
    ...m,
    body:
      `<div>${B(m.title)}<br>🤖=自動で入る（見るだけ）　✍=手で入力する<br><br>` +
      `${m.lines.join('<br>')}<br><br>迷ったら上から順に。詳しい数字はデイリーニュースへ。</div>`,
  }));
}

async function findSpaces() {
  const found = [];
  for (let id = 1; id <= 30; id++) {
    try {
      const s = await call('GET', `/k/v1/space.json?id=${id}`);
      if (s?.id) found.push({ id: s.id, name: s.name, thread: s.defaultThread });
    } catch { /* 存在しないIDはスキップ */ }
  }
  return found;
}

async function main() {
  const mode = arg('mode', 'list');
  const spaces = await findSpaces();

  if (!spaces.length) {
    console.log('スペースが見つかりませんでした（まだ作成されていない可能性があります）。');
    return;
  }
  for (const s of spaces) console.log(`スペースID=${s.id} 名前=${s.name}`);

  if (mode !== 'write') return;

  let wrote = 0;
  for (const s of spaces) {
    const menu = menus().find((m) => m.match.test(s.name));
    if (!menu) {
      console.log(`⏭ ${s.name}: 対応するメニューが無いためスキップ`);
      continue;
    }
    await call('PUT', '/k/v1/space/thread.json', { id: s.thread, body: menu.body });
    console.log(`✅ ${s.name}（ID=${s.id}）にリンク集を書き込みました`);
    wrote++;
  }
  console.log(`完了（書き込み${wrote}件）`);
}

main().catch((e) => {
  console.error('エラー:', e.message, JSON.stringify(e.body ?? '').slice(0, 300));
  process.exit(1);
});
