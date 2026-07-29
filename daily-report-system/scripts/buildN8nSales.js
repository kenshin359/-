// ============================================================
//  n8n ワークフロー⑥（売上レポート）を生成する
// ------------------------------------------------------------
//  n8n の Code ノードは import が使えないため、集計処理を
//  n8n/snippets/salesInline.js から取り込んで埋め込みます。
//
//  実行: npm run build:n8n
//
//  ★手で workflow-6-sales-report.json を編集しないでください。
//    次回の生成で上書きされます。編集するのは snippets 側です。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const snippet = fs
  .readFileSync(path.join(ROOT, 'n8n', 'snippets', 'salesInline.js'), 'utf8')
  .replace(/^export /gm, '') // Code ノードでは export が使えない
  .trim();

const mapping = fs.readFileSync(path.join(ROOT, 'config', 'sales-mapping.json'), 'utf8');

// n8n の Code ノードに入れるコード本体
const jsCode = `// ============================================================
//  売上ファイルを集計して通知文を作る
// ------------------------------------------------------------
//  ★このコードは自動生成されています。
//    直接編集せず、リポジトリの n8n/snippets/salesInline.js を直し、
//    npm run build:n8n で作り直してください。
// ============================================================

// 列の対応表（config/sales-mapping.json の内容）
const MAPPING = ${mapping.trim()};

${snippet}

// ── ここから n8n との受け渡し ──────────────────────────

// 対象日を決める（既定は「昨日」。売上は当日中に確定しないため）
const tz = 'Asia/Tokyo';
const now = new Date();
const jst = new Date(now.toLocaleString('en-US', { timeZone: tz }));
jst.setDate(jst.getDate() - 1);
const pad = (n) => String(n).padStart(2, '0');
const dateISO = \`\${jst.getFullYear()}-\${pad(jst.getMonth() + 1)}-\${pad(jst.getDate())}\`;
jst.setDate(jst.getDate() - 1);
const prevISO = \`\${jst.getFullYear()}-\${pad(jst.getMonth() + 1)}-\${pad(jst.getDate())}\`;

// 前のノードから渡ってきたファイルを取り出す
const files = [];
for (let i = 0; i < items.length; i++) {
  const binary = items[i].binary || {};
  for (const key of Object.keys(binary)) {
    const b = binary[key];
    const buffer = await this.helpers.getBinaryDataBuffer(i, key);
    files.push({ name: b.fileName || \`file-\${i}-\${key}\`, buffer });
  }
}

if (files.length === 0) {
  return [{ json: { skip: true, reason: '読み込めるCSVがありませんでした', dateISO } }];
}

const { text, summary } = buildSalesText(files, MAPPING, dateISO, prevISO);

return [
  {
    json: {
      skip: false,
      dateISO,
      prevISO,
      text,
      fileCount: files.length,
      revenue: summary.totals.revenue,
      adCost: summary.totals.adCost,
      roas: summary.totals.roas,
      problems: summary.problems.map((p) => \`\${p.fileName}: \${p.reason}\`),
    },
  },
];
`;

const workflow = {
  name: 'Libetee ⑥ 売上レポート（Amazon/楽天/自社/Meta/RPP）',
  nodes: [
    {
      parameters: {
        rule: {
          interval: [{ field: 'cronExpression', expression: '0 10 * * *' }],
        },
      },
      id: 'sales-trigger',
      name: '毎日10:00',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-260, 300],
      notes: '前日分の売上を毎朝10時に配信します。時刻はここで変更できます。',
    },
    {
      parameters: {
        fileSelector: '=/data/sales/*',
        options: {},
      },
      id: 'sales-read',
      name: 'CSVを読み込む',
      type: 'n8n-nodes-base.readWriteFile',
      typeVersion: 1,
      position: [-40, 300],
      notes:
        'CSVを置いたフォルダを指定します。\n' +
        'n8nクラウドを使う場合はこのノードを削除し、\n' +
        'Google Drive ノード（Download File）に差し替えてください。',
    },
    {
      parameters: { jsCode },
      id: 'sales-aggregate',
      name: '売上を集計して文面を作る',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [180, 300],
      notes:
        '自動生成されたコードです。直接編集しないでください。\n' +
        'リポジトリの n8n/snippets/salesInline.js を直し、npm run build:n8n で再生成します。',
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, version: 2 },
          conditions: [
            {
              id: 'has-data',
              leftValue: '={{ $json.skip }}',
              rightValue: false,
              operator: { type: 'boolean', operation: 'false', singleValue: true },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'sales-if',
      name: 'データあり?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [400, 300],
    },
    {
      parameters: {
        method: 'POST',
        url: '=https://api.chatwork.com/v2/rooms/{{ $env.CHATWORK_ROOM_ID }}/messages',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'X-ChatWorkToken', value: '={{ $env.CHATWORK_API_TOKEN }}' }],
        },
        sendBody: true,
        contentType: 'form-urlencoded',
        bodyParameters: {
          parameters: [
            { name: 'body', value: '=[info][title]{{ $json.text.split("\\n")[0] }}[/title]{{ $json.text.split("\\n").slice(1).join("\\n") }}[/info]' },
            { name: 'self_unread', value: '0' },
          ],
        },
        options: {},
      },
      id: 'sales-chatwork',
      name: 'Chatworkに通知',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [640, 200],
      onError: 'continueRegularOutput',
      notes: 'CHATWORK_API_TOKEN と CHATWORK_ROOM_ID を n8n の環境変数に設定してください。',
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.line.me/v2/bot/message/push',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.LINE_CHANNEL_ACCESS_TOKEN }}' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ to: $env.LINE_TARGET_GROUP_ID || $env.LINE_TARGET_USER_ID, messages: [{ type: "text", text: $json.text.slice(0, 4900) }] }) }}',
        options: {},
      },
      id: 'sales-line',
      name: 'LINEに通知',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [640, 400],
      onError: 'continueRegularOutput',
      disabled: true,
      notes:
        'LINEにも送りたい場合はこのノードを有効化してください（既定は無効）。\n' +
        'Chatworkだけで足りる場合は無効のままで構いません。',
    },
  ],
  connections: {
    毎日10・00: {},
    '毎日10:00': { main: [[{ node: 'CSVを読み込む', type: 'main', index: 0 }]] },
    CSVを読み込む: { main: [[{ node: '売上を集計して文面を作る', type: 'main', index: 0 }]] },
    売上を集計して文面を作る: { main: [[{ node: 'データあり?', type: 'main', index: 0 }]] },
    'データあり?': {
      main: [
        [
          { node: 'Chatworkに通知', type: 'main', index: 0 },
          { node: 'LINEに通知', type: 'main', index: 0 },
        ],
      ],
    },
  },
  settings: { executionOrder: 'v1', timezone: 'Asia/Tokyo', saveDataErrorExecution: 'all' },
  staticData: null,
  meta: { instanceId: 'libetee-sales-report' },
  tags: [],
};

// 空のキー（JSON整形上の都合で入れたダミー）を除去
delete workflow.connections['毎日10・00'];

const outPath = path.join(ROOT, 'n8n', 'workflow-6-sales-report.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');

console.log(`✅ 生成しました: ${path.relative(ROOT, outPath)}`);
console.log(`   埋め込んだ集計コード: ${snippet.split('\n').length}行`);
console.log(`   列の対応表: ${JSON.parse(mapping).channels.length}媒体`);
