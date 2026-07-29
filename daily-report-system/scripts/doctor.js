// ============================================================
//  総点検ツール（設定がちゃんとできているか調べる）
// ------------------------------------------------------------
//  4つのサービスすべてに実際に接続して、動く状態かを確認します。
//  問題があれば「何をすれば直るか」を日本語で表示します。
//
//  実行:  npm run doctor
//
//  ※ 何も壊しません。読み取りと確認だけを行います。
// ============================================================
import { optional, isProduction } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { authHeadersFor } from '../lib/kintone.js';
import { todayISO } from '../lib/date.js';
import { extractReports } from '../lib/extractReports.js';

const results = [];
const line = (s = '') => console.log(s);

// エラー本文を人が読める短い1行に整える
// （HTMLやJSONがそのまま出ると初心者には意味不明なので、要点だけ抜き出す）
function tidy(message, max = 100) {
  let s = String(message);
  // HTMLページが返ってきた場合はタグを除去
  if (/<html|<!DOCTYPE/i.test(s)) s = s.replace(/<[^>]*>/g, ' ');
  // JSONエラーなら message 部分だけ取り出す
  const m = s.match(/"message"\s*:\s*"([^"]+)"/);
  if (m) s = m[1];
  // HTTPステータスは残す
  const status = String(message).match(/HTTP (\d{3})/);
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max) + '…';
  return status ? `HTTP ${status[1]}: ${s.replace(/^\[.*?\] ?HTTP \d{3}: ?/, '')}` : s;
}

// 判定を記録する
function ok(name, detail) {
  results.push({ status: 'ok', name, detail });
  line(`  ✅ ${name}`);
  if (detail) line(`      ${detail}`);
}
function ng(name, detail, fix) {
  results.push({ status: 'ng', name, detail, fix });
  line(`  ❌ ${name}`);
  if (detail) line(`      ${detail}`);
  if (fix) line(`      → 対処: ${fix}`);
}
function skip(name, detail, fix) {
  results.push({ status: 'skip', name, detail, fix });
  line(`  ⏭  ${name}（未設定）`);
  if (detail) line(`      ${detail}`);
  if (fix) line(`      → 設定するには: ${fix}`);
}
function section(t) {
  line('');
  line(`── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`);
}

// ── 1. 設定ファイル ──────────────────────────────────────
function checkEnv() {
  section('1. 設定ファイル');
  const base = optional('KINTONE_BASE_URL');
  if (base) ok('設定ファイル(.env) が読み込めました', `Kintone: ${base}`);
  else {
    ng('設定ファイル(.env) が見つからない、または未設定です', null, 'npm run setup を実行してください');
    return false;
  }
  line(`  ${isProduction() ? '🔴 本番モード：LINEに実際に送信されます' : '🟢 テストモード：LINEには送信されません（安全）'}`);
  return true;
}

// ── 2. Kintone ───────────────────────────────────────────
async function checkKintone() {
  section('2. Kintone');
  const base = optional('KINTONE_BASE_URL').replace(/\/$/, '');

  // 認証方式の確認
  let headers;
  try {
    headers = authHeadersFor(optional('KINTONE_API_TOKEN_DAILY_REPORT') || null);
    const mode = headers['X-Cybozu-API-Token'] ? 'APIトークン認証' : 'ログインID/パスワード認証';
    ok('Kintoneの認証情報あり', `方式: ${mode}`);
  } catch (e) {
    ng('Kintoneの認証情報がありません', e.message.split('\n')[0], 'npm run setup を実行してください');
    return;
  }

  // 日報アプリ
  const dailyApp = optional('KINTONE_DAILY_REPORT_APP_ID');
  if (!dailyApp) {
    ng('日報アプリのIDが未設定です', null, 'npm run setup、または npm run apps でIDを確認');
  } else {
    try {
      const res = await fetchWithRetry(
        `${base}/k/v1/records.json?app=${dailyApp}&query=${encodeURIComponent('limit 1')}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json', ...headers } },
        { label: 'kintone', retries: 1 }
      );
      ok(`日報アプリ(ID ${dailyApp})に接続できました`, `レコード取得テスト: 成功`);

      // 日報を正しく取り出せるか（アプリの構造に依存しない抽出をテスト）
      await checkExtraction(base, headers, dailyApp);
    } catch (e) {
      const m = String(e.message);
      ng(
        `日報アプリ(ID ${dailyApp})に接続できません`,
        tidy(m),
        m.includes('401') || m.includes('403')
          ? 'ID/パスワードが違うか、そのアカウントにアプリの閲覧権限がありません'
          : 'アプリIDが正しいか確認してください（npm run apps）'
      );
    }
  }

  // AI経営日報アプリ
  const aiApp = optional('KINTONE_AI_REPORT_APP_ID');
  if (!aiApp) {
    ng('AI経営日報アプリのIDが未設定です', null, 'npm run setup、または npm run create-apps -- ai');
  } else {
    try {
      const aiHeaders = authHeadersFor(optional('KINTONE_API_TOKEN_AI_REPORT') || null);
      await fetchWithRetry(
        `${base}/k/v1/records.json?app=${aiApp}&query=${encodeURIComponent('limit 1')}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json', ...aiHeaders } },
        { label: 'kintone', retries: 1 }
      );
      ok(`AI経営日報アプリ(ID ${aiApp})に接続できました`);
    } catch (e) {
      ng(`AI経営日報アプリ(ID ${aiApp})に接続できません`, tidy(e.message), 'アプリIDと権限を確認してください');
    }
  }
}

// 日報を「日付・氏名・本文」として取り出せるか実際に試す。
// アプリの項目構成に依存しない方式なので、フィールドの追加は不要。
async function checkExtraction(base, headers, appId) {
  try {
    const res = await fetchWithRetry(
      `${base}/k/v1/records.json?app=${appId}&query=${encodeURIComponent('order by $id desc limit 100')}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json', ...headers } },
      { label: 'kintone', retries: 1 }
    );
    const records = res.json?.records ?? [];
    const reports = extractReports(records);

    if (!reports.length) {
      skip(
        '日報を取り出せませんでした',
        `レコード ${records.length} 件を調べましたが、日報らしき本文が見つかりません`,
        'node scripts/fetchDailyReports.js --all でデータの入り方を確認してください'
      );
      return;
    }

    // 日付の範囲と人数を表示
    const dates = [...new Set(reports.map((r) => r.date).filter(Boolean))].sort();
    const people = [...new Set(reports.map((r) => r.reporter).filter(Boolean))];
    ok(
      `日報を ${reports.length} 件 取り出せました`,
      `期間: ${dates[0] ?? '?'} 〜 ${dates[dates.length - 1] ?? '?'} / 報告者: ${people.join('・') || '(不明)'}`
    );

    // 本日分があるか
    const today = todayISO();
    const n = reports.filter((r) => r.date === today).length;
    if (n > 0) ok(`本日(${today})の日報: ${n} 件`);
    else
      skip(
        `本日(${today})の日報: 0 件`,
        'まだ本日分が入力されていないだけの可能性があります',
        `過去日で試すには: npm run pipeline -- --date=${dates[dates.length - 1] ?? today}`
      );
  } catch (e) {
    skip('日報の取り出しを確認できませんでした', tidy(e.message));
  }
}

// ── 3. Claude ────────────────────────────────────────────
async function checkClaude() {
  section('3. Claude（AI）');
  const key = optional('ANTHROPIC_API_KEY');
  if (!key) {
    skip('Claude APIキーが未設定です', 'AIによる日報分析ができません', 'https://console.anthropic.com でキーを発行し .env に設定');
    return;
  }
  try {
    const res = await fetchWithRetry(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: optional('ANTHROPIC_MODEL', 'claude-sonnet-5'),
          max_tokens: 8,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      },
      { label: 'claude', retries: 1 }
    );
    ok('Claudeに接続できました', `モデル: ${res.json?.model ?? optional('ANTHROPIC_MODEL', 'claude-sonnet-5')}`);
  } catch (e) {
    const m = String(e.message);
    ng(
      'Claudeに接続できません',
      tidy(m),
      m.includes('401')
        ? 'APIキーが違います。console.anthropic.com で再確認してください'
        : m.includes('404')
          ? `モデル名が違う可能性があります（現在: ${optional('ANTHROPIC_MODEL', 'claude-sonnet-5')}）`
          : m.includes('429')
            ? '利用上限に達しています。少し待つか、プランをご確認ください'
            : '通信エラーです。時間をおいて再実行してください'
    );
  }
}

// ── 4. LINE ──────────────────────────────────────────────
async function checkLine() {
  section('4. LINE');
  const token = optional('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) {
    skip('LINEトークンが未設定です', '通知が送れません（Kintoneへの保存までは動きます）', 'docs/line-setup.md の手順で発行');
    return;
  }
  try {
    const res = await fetchWithRetry(
      'https://api.line.me/v2/bot/info',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      { label: 'line', retries: 1 }
    );
    ok('LINEに接続できました', `公式アカウント: ${res.json?.displayName ?? '(名称不明)'}`);
  } catch (e) {
    ng('LINEに接続できません', tidy(e.message), 'チャネルアクセストークンを再発行して .env に設定してください');
  }

  const group = optional('LINE_TARGET_GROUP_ID');
  const user = optional('LINE_TARGET_USER_ID');
  if (group) ok('送信先: グループ', group.slice(0, 8) + '…');
  else if (user) ok('送信先: 個人ユーザー', user.slice(0, 8) + '…');
  else
    ng(
      '送信先IDが未設定です',
      'グループIDもユーザーIDもありません',
      'node scripts/lineWebhookPeek.js で確認（docs/line-setup.md）'
    );
}

// ── まとめ ───────────────────────────────────────────────
function summary() {
  const ngs = results.filter((r) => r.status === 'ng');
  const skips = results.filter((r) => r.status === 'skip');
  const oks = results.filter((r) => r.status === 'ok');

  line('');
  line('━'.repeat(58));
  line(`  結果： ✅ ${oks.length} 件OK   ❌ ${ngs.length} 件 要対応   ⏭ ${skips.length} 件 未設定`);
  line('━'.repeat(58));

  if (!ngs.length && !skips.length) {
    line('');
    line('  🎉 すべて準備できています！');
    line('     npm run pipeline  で日報の自動生成を実行できます。');
    line('');
    return;
  }

  if (ngs.length) {
    line('');
    line('  【いま直すべきこと】');
    ngs.forEach((r, i) => {
      line(`    ${i + 1}. ${r.name}`);
      if (r.fix) line(`       → ${r.fix}`);
    });
  }
  if (skips.length) {
    line('');
    line('  【あとで設定すればよいもの】');
    skips.forEach((r, i) => {
      line(`    ${i + 1}. ${r.name}`);
      if (r.fix) line(`       → ${r.fix}`);
    });
  }
  line('');
  line('  困ったら docs/error-handling.md を見てください。');
  line('');
}

async function main() {
  line('');
  line('╔════════════════════════════════════════════════════════╗');
  line('║   Libetee AI日報システム  総点検（doctor）             ║');
  line('╚════════════════════════════════════════════════════════╝');

  if (!checkEnv()) {
    summary();
    return;
  }
  await checkKintone();
  await checkClaude();
  await checkLine();
  summary();
}

main().catch((e) => {
  line('');
  line(`予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
