// ============================================================
//  「元データを絶対に変更しない」ことを保証するテスト
// ------------------------------------------------------------
//  ご要望により、スタッフ日報アプリ（元データ）へは
//  一切書き込まない設計にしています。
//  将来うっかり書き込み処理が追加されても、このテストが検知します。
//
//  判定方法：
//   関数のかたまり単位で見て、「日報アプリIDを参照している」かつ
//   「書き込み(PUT/POST/DELETE)をしている」ものを違反とする。
//   （行単位で見ると、IDの参照と書き込みが別の行にある場合に見逃すため）
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DAILY_APP_ENV = 'KINTONE_DAILY_REPORT_APP_ID';
// 書き込みを示すパターン
const WRITE_PATTERN = /['"]PUT['"]|['"]DELETE['"]|api\(\s*['"]POST['"]|method:\s*['"](PUT|POST|DELETE)['"]/;

const SKIP_DIRS = new Set(['node_modules', 'backups', 'out', '.git']);

function collect(dir, exts, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) collect(p, exts, acc);
    else if (exts.some((e) => name.endsWith(e))) acc.push(p);
  }
  return acc;
}

/**
 * ソースを「関数のかたまり」に分割する。
 * function 宣言の行を境目とし、それ以前は先頭ブロックとして扱う。
 */
function splitIntoFunctionBlocks(src) {
  const lines = src.split('\n');
  const starts = [];
  lines.forEach((l, i) => {
    if (/^\s*(export\s+)?(async\s+)?function\s+\w+/.test(l)) starts.push(i);
  });
  if (!starts.length) return [src];

  const blocks = [];
  if (starts[0] > 0) blocks.push(lines.slice(0, starts[0]).join('\n'));
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : lines.length;
    blocks.push(lines.slice(from, to).join('\n'));
  }
  return blocks;
}

/** ソース中の違反箇所（関数ブロック）を返す */
function findViolations(src) {
  return splitIntoFunctionBlocks(src).filter(
    (block) => block.includes(DAILY_APP_ENV) && WRITE_PATTERN.test(block)
  );
}

/** n8nノード1つを検査して違反を返す */
function findNodeViolations(fileName, node) {
  const p = node.parameters ?? {};
  const serialized = JSON.stringify(p);
  const isWriteMethod = p.method === 'PUT' || p.method === 'POST' || p.method === 'DELETE';
  const touchesDaily = serialized.includes(DAILY_APP_ENV);
  const isKintoneCall = serialized.includes('KINTONE_BASE_URL') || serialized.includes('cybozu.com');
  return isWriteMethod && touchesDaily && isKintoneCall ? [`${fileName} のノード「${node.name}」`] : [];
}

// ── 実際のコードベースを検査 ────────────────────────────

test('日報アプリ(元データ)への書き込み処理が存在しない', () => {
  const files = collect(ROOT, ['.js']).filter((f) => !f.endsWith('readonly.test.js'));
  const offenders = [];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes(DAILY_APP_ENV)) continue;
    for (const block of findViolations(src)) {
      const firstLine = block.split('\n').find((l) => l.trim()) ?? '';
      offenders.push(`${path.relative(ROOT, file)} → ${firstLine.trim().slice(0, 80)}`);
    }
  }

  assert.deepEqual(offenders, [], '元データ(日報アプリ)へ書き込む処理が見つかりました:\n' + offenders.join('\n'));
});

test('n8nワークフローに日報アプリへの書き込みノードが無い', () => {
  const dir = path.join(ROOT, 'n8n');
  const offenders = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const wf = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const node of wf.nodes ?? []) offenders.push(...findNodeViolations(name, node));
  }
  assert.deepEqual(offenders, [], '日報アプリへ書き込むノードがあります:\n' + offenders.join('\n'));
});

// ── 検知ロジック自体が働くことの確認（テストの形骸化を防ぐ）──

test('検知ロジックが実際に違反コードを見つけられる', () => {
  const bad = `
export async function badWrite(id, rec) {
  const app = required('${DAILY_APP_ENV}');
  return api('PUT', '/k/v1/record.json', null, { app, id, record: rec });
}
`;
  assert.equal(findViolations(bad).length, 1, '違反コードを検知できていない');
});

test('検知ロジックが読み取り専用コードを誤検知しない', () => {
  const good = `
export async function fetchAllDailyReportRecords() {
  const app = required('${DAILY_APP_ENV}');
  const res = await api('GET', '/k/v1/records.json', token);
  return res.records ?? [];
}
export async function createAiReport(record) {
  const app = required('KINTONE_AI_REPORT_APP_ID');
  return api('POST', '/k/v1/record.json', token, { app, record });
}
`;
  assert.equal(findViolations(good).length, 0, '読み取り専用のコードを誤検知している');
});

test('n8n検知ロジックが実際に違反ノードを見つけられる', () => {
  const badNode = {
    name: '危険な更新ノード',
    parameters: {
      method: 'PUT',
      url: '={{ $env.KINTONE_BASE_URL }}/k/v1/record.json',
      jsonBody: `={{ JSON.stringify({ app: $env.${DAILY_APP_ENV}, id: 1, record: {} }) }}`,
    },
  };
  assert.equal(findNodeViolations('test.json', badNode).length, 1, 'n8nの違反ノードを検知できていない');

  const goodNode = {
    name: '取得ノード',
    parameters: { method: 'GET', url: '={{ $env.KINTONE_BASE_URL }}/k/v1/records.json' },
  };
  assert.equal(findNodeViolations('test.json', goodNode).length, 0);
});
