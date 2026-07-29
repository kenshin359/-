// ============================================================
//  セットアップウィザード（対話式・初心者向け）
// ------------------------------------------------------------
//  質問に答えていくだけで、.env の作成からKintoneアプリの準備まで
//  自動で終わらせます。入力した値はその場で実際に接続テストして、
//  間違っていればやり直せます。
//
//  実行:  npm run setup
//
//  途中でやめたい場合は Ctrl + C。何度でもやり直せます。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { fetchWithRetry } from '../lib/httpRetry.js';
import { extractReports } from '../lib/extractReports.js';
import { FIELDS as AI_FIELDS, APP_NAME as AI_APP_NAME } from '../kintone/aiReportSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

// 自動化に最低限必要なフィールド

const rl = readline.createInterface({ input, output });
const answers = {};

// ── 入力行のキュー ───────────────────────────────────────
// readline の question() は「呼んだ瞬間の次の1行」しか受け取れないため、
// 貼り付け入力やパイプ入力だと行が取りこぼされて無言終了してしまう。
// そこで届いた行を必ずキューに貯め、順番に取り出す方式にする。
const lineQueue = [];
const waiters = [];
let inputClosed = false;

rl.on('line', (l) => {
  const w = waiters.shift();
  if (w) w(l);
  else lineQueue.push(l);
});
rl.on('close', () => {
  inputClosed = true;
  while (waiters.length) waiters.shift()(null); // 待機中の質問を解放
});

// 次の1行を取り出す（入力が終わっていれば null）
function nextLine() {
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  if (inputClosed) return Promise.resolve(null);
  return new Promise((resolve) => waiters.push(resolve));
}

// ── 表示ヘルパー ────────────────────────────────────────
const line = (s = '') => console.log(s);
function title(n, total, text) {
  line('');
  line('━'.repeat(58));
  line(`  ステップ ${n}/${total}：${text}`);
  line('━'.repeat(58));
}
function hint(...lines) {
  for (const l of lines) line('  ' + l);
  line('');
}

// エラー本文を人が読める短い1行に整える（HTMLやJSONをそのまま見せない）
function tidy(message, max = 90) {
  let s = String(message);
  if (/<html|<!DOCTYPE/i.test(s)) s = s.replace(/<[^>]*>/g, ' ');
  const m = s.match(/"message"\s*:\s*"([^"]+)"/);
  if (m) s = m[1];
  const status = String(message).match(/HTTP (\d{3})/);
  s = s.replace(/\s+/g, ' ').replace(/^\[.*?\] ?HTTP \d{3}: ?/, '').trim();
  if (s.length > max) s = s.slice(0, max) + '…';
  return status ? `HTTP ${status[1]}: ${s}` : s;
}

// 質問する（空入力なら既定値）
async function ask(question, { def = '', secret = false } = {}) {
  const suffix = def ? `（未入力なら ${secret ? '既定値' : def}）` : '';
  output.write(`  ▶ ${question}${suffix}\n    > `);
  const raw = await nextLine();
  if (raw === null) throw new Error('入力が終了しました（Ctrl+C か 入力切れ）');
  const a = raw.trim();
  return a || def;
}

async function askYesNo(question, def = true) {
  output.write(`  ▶ ${question} (y/n${def ? '・未入力ならy' : '・未入力ならn'})\n    > `);
  const raw = await nextLine();
  if (raw === null) throw new Error('入力が終了しました（Ctrl+C か 入力切れ）');
  const a = raw.trim().toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
}

// Kintone 認証ヘッダー（ウィザード中はパスワード認証を使う）
function kintoneAuth() {
  return {
    'X-Cybozu-Authorization': Buffer.from(`${answers.KINTONE_USER}:${answers.KINTONE_PASSWORD}`).toString('base64'),
  };
}

async function kintoneCall(method, apiPath, body) {
  const res = await fetchWithRetry(
    `${answers.KINTONE_BASE_URL.replace(/\/$/, '')}${apiPath}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...kintoneAuth() },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    },
    { label: `kintone ${method}`, retries: 1 }
  );
  return res.json ?? {};
}

// ============================================================
//  ステップ1：Kintone のURL
// ============================================================
async function step1() {
  title(1, 6, 'Kintone のアドレスを教えてください');
  hint(
    'Kintoneを開いたときのブラウザのアドレス欄を見てください。',
    '  https://○○○○○.cybozu.com/k/...  ← この「.cybozu.com」までの部分です。'
  );
  // 既存 .env.example / 画面から判明しているサブドメインを既定値に
  const def = 'https://w6pq7i12hn4b.cybozu.com';
  answers.KINTONE_BASE_URL = await ask('KintoneのURL', { def });
  if (!/^https:\/\/[^/]+\.cybozu\.com$/.test(answers.KINTONE_BASE_URL.replace(/\/$/, ''))) {
    line('  ⚠️  形式が違うかもしれませんが、このまま進めます。');
  }
  answers.KINTONE_BASE_URL = answers.KINTONE_BASE_URL.replace(/\/$/, '');
}

// ============================================================
//  ステップ2：Kintone のログイン情報（接続テストつき）
// ============================================================
async function step2() {
  title(2, 6, 'Kintone のログイン情報');
  hint(
    'いつもKintoneにログインしている ID とパスワードです。',
    '※ できれば「連携用」の専用アカウントを作るのが安全ですが、',
    '   まずは動かすことを優先してご自身のIDでも構いません。',
    '※ 入力した値はこのパソコンの .env ファイルにだけ保存され、',
    '   外部に送信されることはありません（Kintoneへのログインにのみ使用）。'
  );

  for (let i = 0; i < 5; i++) {
    answers.KINTONE_USER = await ask('KintoneのログインID');
    answers.KINTONE_PASSWORD = await ask('Kintoneのパスワード', { secret: true });

    process.stdout.write('  … 接続を確認しています');
    try {
      const res = await kintoneCall('GET', '/k/v1/apps.json?limit=100');
      answers.__apps = res.apps ?? [];
      line(`\r  ✅ ログイン成功！ アプリが ${answers.__apps.length} 個見つかりました。`);
      return;
    } catch (e) {
      line('\r  ❌ ログインできませんでした。');
      if (String(e.message).includes('401')) hint('IDかパスワードが違うようです。もう一度お試しください。');
      else hint(`エラー内容: ${tidy(e.message)}`);
      if (i < 4 && !(await askYesNo('もう一度入力しますか？'))) throw new Error('中断しました');
    }
  }
  throw new Error('ログインに失敗しました');
}

// ============================================================
//  ステップ3：日報アプリを選ぶ（自動検出）
// ============================================================
async function step3() {
  title(3, 6, 'スタッフが日報を書いているアプリを選びます');

  const apps = answers.__apps;
  // 「日報」を含むアプリを自動で探す
  const candidates = apps.filter((a) => /日報|日次|レポート/.test(a.name));

  if (candidates.length) {
    line('  自動で見つけた候補：');
    candidates.forEach((a, i) => line(`    ${i + 1}) [ID ${a.appId}] ${a.name}`));
    line('');
  }
  line('  すべてのアプリ：');
  apps.forEach((a) => line(`      [ID ${String(a.appId).padStart(4)}] ${a.name}`));
  line('');

  const def = candidates.length ? String(candidates[0].appId) : '';
  answers.KINTONE_DAILY_REPORT_APP_ID = await ask('日報アプリのID（上の番号から選んでください）', { def });

  const picked = apps.find((a) => String(a.appId) === String(answers.KINTONE_DAILY_REPORT_APP_ID));
  line(`  → 「${picked?.name ?? '(不明)'}」(ID ${answers.KINTONE_DAILY_REPORT_APP_ID}) を使います。`);

  // ── 実際に日報を取り出せるか確認する ──
  //    Kintone側は一切変更しません。いまの構造のまま読み取れるかを試します。
  line('  … このアプリから日報を取り出せるか試します（変更は行いません）');
  try {
    const res = await kintoneCall(
      'GET',
      `/k/v1/records.json?app=${encodeURIComponent(answers.KINTONE_DAILY_REPORT_APP_ID)}` +
        `&query=${encodeURIComponent('order by $id desc limit 100')}`
    );
    const reports = extractReports(res.records ?? []);

    if (!reports.length) {
      line('  ⚠️  日報らしき本文が見つかりませんでした。');
      hint(
        'アプリIDが違うか、まだ日報が入力されていない可能性があります。',
        'あとで  node scripts/fetchDailyReports.js --all  で確認できます。'
      );
      return;
    }

    const dates = [...new Set(reports.map((r) => r.date).filter(Boolean))].sort();
    const people = [...new Set(reports.map((r) => r.reporter).filter(Boolean))];
    line(`  ✅ 日報を ${reports.length} 件 取り出せました。`);
    line(`      期間  : ${dates[0] ?? '?'} 〜 ${dates[dates.length - 1] ?? '?'}`);
    line(`      報告者: ${people.join('・') || '(氏名不明)'}`);

    // 取り出せた中身を1件だけ見せて、正しく読めているか目視確認してもらう
    const sample = reports[0];
    line('');
    line('  ── 取り出せた日報の例 ──');
    line(`  [${sample.date}] ${sample.reporter ?? '(氏名不明)'}`);
    line(`  ${sample.text.replace(/\n/g, '\n  ').slice(0, 160)}…`);
    line('');
    answers.__sampleDate = dates[dates.length - 1] ?? null;
  } catch (e) {
    line(`  ⚠️  日報の取り出しを確認できませんでした: ${tidy(e.message)}`);
    hint('設定は続行できます。あとで npm run doctor で確認してください。');
  }
}

async function waitDeploy(app) {
  for (let i = 0; i < 40; i++) {
    const r = await kintoneCall('GET', `/k/v1/preview/app/deploy.json?apps[0]=${app}`);
    const s = r.apps?.[0]?.status;
    if (s === 'SUCCESS') return;
    if (s === 'FAIL' || s === 'CANCEL') throw new Error(`反映に失敗しました: ${s}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('反映がタイムアウトしました');
}

// ============================================================
//  ステップ4：AI経営日報アプリを作る
// ============================================================
async function step4() {
  title(4, 6, 'AIが作った報告を保存するアプリを用意します');

  const exist = answers.__apps.find((a) => a.name === AI_APP_NAME);
  if (exist) {
    line(`  すでに「${AI_APP_NAME}」(ID ${exist.appId}) がありました。これを使います。`);
    answers.KINTONE_AI_REPORT_APP_ID = String(exist.appId);
    return;
  }

  hint(`「${AI_APP_NAME}」というアプリを新しく作ります（Claudeの報告の保存先です）。`);
  if (!(await askYesNo('自動で作成してよいですか？'))) {
    line('  ⏭  スキップしました。あとで npm run create-apps -- ai で作れます。');
    answers.KINTONE_AI_REPORT_APP_ID = 'TODO';
    return;
  }

  line('  … 作成しています');
  const created = await kintoneCall('POST', '/k/v1/preview/app.json', { name: AI_APP_NAME });
  const app = created.app;
  await kintoneCall('POST', '/k/v1/preview/app/form/fields.json', { app, properties: AI_FIELDS });
  await kintoneCall('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  await waitDeploy(app);
  answers.KINTONE_AI_REPORT_APP_ID = String(app);
  line(`  ✅ 「${AI_APP_NAME}」(ID ${app}) を作成しました。`);
}

// ============================================================
//  ステップ5：Claude APIキー（接続テストつき）
// ============================================================
async function step5() {
  title(5, 6, 'Claude（AI）のAPIキー');
  hint(
    '日報を分析するAIの鍵です。',
    '取得先: https://console.anthropic.com → 「API Keys」→ Create Key',
    '「sk-ant-」で始まる長い文字列をコピーして貼り付けてください。',
    '※ あとで設定する場合は、何も入力せずEnterで飛ばせます。'
  );

  for (let i = 0; i < 3; i++) {
    const key = await ask('Claude APIキー（飛ばす場合はEnter）');
    if (!key) {
      answers.ANTHROPIC_API_KEY = 'TODO';
      line('  ⏭  あとで .env に設定してください。');
      return;
    }
    process.stdout.write('  … 接続を確認しています');
    try {
      await fetchWithRetry(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: answers.ANTHROPIC_MODEL || 'claude-sonnet-5',
            max_tokens: 8,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        },
        { label: 'claude', retries: 1 }
      );
      answers.ANTHROPIC_API_KEY = key;
      line('\r  ✅ Claudeに接続できました！');
      return;
    } catch (e) {
      line('\r  ❌ 接続できませんでした。');
      hint(String(e.message).includes("401") ? "キーが違うようです。" : `エラー: ${tidy(e.message)}`);
      if (!(await askYesNo('もう一度入力しますか？'))) {
        answers.ANTHROPIC_API_KEY = 'TODO';
        return;
      }
    }
  }
  answers.ANTHROPIC_API_KEY = 'TODO';
}

// ============================================================
//  ステップ6：LINE（接続テストつき）
// ============================================================
async function step6() {
  title(6, 6, 'LINE通知の設定');
  hint(
    '社長・部長へ通知を送るための設定です。',
    '取得先: https://developers.line.biz → 対象チャネル → Messaging API設定',
    '　　　　→「チャネルアクセストークン（長期）」を発行してコピー',
    '※ あとで設定する場合は、何も入力せずEnterで飛ばせます。',
    '   （LINE未設定でも、Kintoneへの保存までは動きます）'
  );

  const token = await ask('LINEチャネルアクセストークン（飛ばす場合はEnter）');
  if (!token) {
    answers.LINE_CHANNEL_ACCESS_TOKEN = 'TODO';
    answers.LINE_TARGET_GROUP_ID = 'TODO';
    answers.LINE_TARGET_USER_ID = 'TODO';
    line('  ⏭  あとで docs/line-setup.md を見て設定してください。');
    return;
  }

  process.stdout.write('  … 接続を確認しています');
  try {
    const res = await fetchWithRetry(
      'https://api.line.me/v2/bot/info',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      { label: 'line', retries: 1 }
    );
    line(`\r  ✅ LINE公式アカウント「${res.json?.displayName ?? '(名称不明)'}」に接続できました！`);
    answers.LINE_CHANNEL_ACCESS_TOKEN = token;
  } catch (e) {
    line('\r  ❌ 接続できませんでした（トークンが違う可能性）。値は保存しておきます。');
    answers.LINE_CHANNEL_ACCESS_TOKEN = token;
  }

  hint(
    '次に「どこに送るか」のIDが必要です。',
    '  ・社長と部長のグループに送る場合 → グループID（推奨）',
    '  ・個人に送る場合 → ユーザーID',
    'IDが分からない場合は、Enterで飛ばして後から設定できます。',
    '（確認方法: node scripts/lineWebhookPeek.js／docs/line-setup.md）'
  );
  answers.LINE_TARGET_GROUP_ID = (await ask('送信先グループID（分からなければEnter）')) || 'TODO';
  answers.LINE_TARGET_USER_ID = (await ask('送信先ユーザーID（分からなければEnter）')) || 'TODO';
}

// ============================================================
//  .env の書き出し
// ============================================================
function writeEnv() {
  const v = (k, d = 'TODO') => answers[k] || d;
  const content = `# ============================================================
#  Libetee AI 日報システム  設定ファイル
#  npm run setup で自動生成されました（手で書き換えてもOK）
#  ※ このファイルは絶対に他人に渡さないでください（パスワードを含みます）
# ============================================================

# ── Kintone ─────────────────────────────────────────────
KINTONE_BASE_URL=${v('KINTONE_BASE_URL')}
KINTONE_DAILY_REPORT_APP_ID=${v('KINTONE_DAILY_REPORT_APP_ID')}
KINTONE_AI_REPORT_APP_ID=${v('KINTONE_AI_REPORT_APP_ID')}

# ログイン情報（これだけで動きます）
KINTONE_USER=${v('KINTONE_USER', '')}
KINTONE_PASSWORD=${v('KINTONE_PASSWORD', '')}

# APIトークン（より安全にしたい場合のみ設定。空ならログイン情報を使用）
KINTONE_API_TOKEN_DAILY_REPORT=
KINTONE_API_TOKEN_AI_REPORT=

# ── Claude（AI） ────────────────────────────────────────
ANTHROPIC_API_KEY=${v('ANTHROPIC_API_KEY')}
ANTHROPIC_MODEL=claude-sonnet-5

# ── LINE ────────────────────────────────────────────────
LINE_CHANNEL_ACCESS_TOKEN=${v('LINE_CHANNEL_ACCESS_TOKEN')}
LINE_TARGET_GROUP_ID=${v('LINE_TARGET_GROUP_ID')}
LINE_TARGET_USER_ID=${v('LINE_TARGET_USER_ID')}

# ── n8n / Webhook ───────────────────────────────────────
N8N_WEBHOOK_URL=TODO
WEBHOOK_SECRET=${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}

# ── レポート設定 ────────────────────────────────────────
REPORT_TIMEZONE=Asia/Tokyo
REPORT_SEND_TIME=19:00

# production にすると実際にLINEへ送信されます（test の間は送信されません）
APP_ENV=test
`;
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

// ============================================================
//  メイン
// ============================================================
async function main() {
  line('');
  line('╔════════════════════════════════════════════════════════╗');
  line('║   Libetee AI日報システム  かんたんセットアップ         ║');
  line('╚════════════════════════════════════════════════════════╝');
  hint(
    '質問に答えていくだけで設定が完了します。',
    'わからない項目は Enter で飛ばせます（あとから設定できます）。',
    'やめたいときは Ctrl + C を押してください。'
  );

  if (fs.existsSync(ENV_PATH)) {
    line('  ⚠️  すでに設定ファイル(.env)があります。');
    if (!(await askYesNo('上書きして最初からやり直しますか？', false))) {
      line('  中止しました。');
      return;
    }
  }

  await step1();
  await step2();
  await step3();
  await step4();
  await step5();
  await step6();

  writeEnv();

  line('');
  line('╔════════════════════════════════════════════════════════╗');
  line('║   ✅ セットアップ完了！                                ║');
  line('╚════════════════════════════════════════════════════════╝');
  line('');
  line('  設定を .env に保存しました。');
  line('');
  line('  次にこれを実行してください：');
  line('');
  line('      npm run doctor      … 設定がちゃんとできているか総点検');
  line('      npm run pipeline    … 日報の取得〜報告作成を実際に動かす');
  line('');
  line('  ※ いまは「テストモード」です。LINEには実際には送信されません。');
  line('     本番で送るときは .env の APP_ENV=production に変更してください。');
  line('');
}

main()
  .catch((e) => {
    line('');
    line(`  ⚠️  ${e.message}`);
    line('  もう一度 npm run setup で最初からやり直せます。');
    process.exitCode = 1;
  })
  .finally(() => rl.close());
