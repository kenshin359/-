// ============================================================
//  n8n 埋め込み版と lib/ 版がズレていないことを確認する
// ------------------------------------------------------------
//  n8n の Code ノードは import が使えないため、同じ処理を
//  n8n/snippets/salesInline.js に複製しています。
//
//  複製がある以上、片方だけ直して気づかない事故が起きえます。
//  金額を扱う以上それは許容できないので、
//  「同じ入力なら1文字違わず同じ文面になる」ことを毎回検証します。
// ============================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregateFile, buildDailySummary } from '../lib/salesAggregate.js';
import { formatSalesSummary } from '../lib/salesFormat.js';
import { buildSalesText } from '../n8n/snippets/salesInline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples', 'sales');
const MAPPING = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'sales-mapping.json'), 'utf8'));

const FILES = fs
  .readdirSync(SAMPLES)
  .filter((f) => /\.(csv|tsv)$/i.test(f))
  .map((name) => ({ name, buffer: fs.readFileSync(path.join(SAMPLES, name)) }));

function viaLib(dateISO, prevISO, opts) {
  const results = FILES.map((f) => aggregateFile(f, MAPPING));
  return formatSalesSummary(buildDailySummary(results, dateISO, prevISO), opts);
}

describe('n8n埋め込み版と lib/ 版の一致', () => {
  test('通常の日: 文面が完全に一致する', () => {
    const inline = buildSalesText(FILES, MAPPING, '2026-07-29', '2026-07-28').text;
    assert.equal(inline, viaLib('2026-07-29', '2026-07-28'));
  });

  test('前日データが無い日でも一致する', () => {
    const inline = buildSalesText(FILES, MAPPING, '2026-07-28', '2026-07-27').text;
    assert.equal(inline, viaLib('2026-07-28', '2026-07-27'));
  });

  test('データが1件も無い日でも一致する', () => {
    const inline = buildSalesText(FILES, MAPPING, '2020-01-01', '2019-12-31').text;
    assert.equal(inline, viaLib('2020-01-01', '2019-12-31'));
  });

  test('AIコメント付きでも一致する', () => {
    const opts = { comment: 'テストコメント' };
    const inline = buildSalesText(FILES, MAPPING, '2026-07-29', '2026-07-28', opts).text;
    assert.equal(inline, viaLib('2026-07-29', '2026-07-28', opts));
  });

  test('判別できないファイルの報告も一致する', () => {
    const withBad = [...FILES, { name: 'なぞ.csv', buffer: Buffer.from('a\n1\n') }];
    const inline = buildSalesText(withBad, MAPPING, '2026-07-29', '2026-07-28').text;
    const results = withBad.map((f) => aggregateFile(f, MAPPING));
    assert.equal(inline, formatSalesSummary(buildDailySummary(results, '2026-07-29', '2026-07-28')));
  });

  test('集計値そのものも一致する（文面だけでなく数字を直接比較）', () => {
    const inline = buildSalesText(FILES, MAPPING, '2026-07-29', '2026-07-28').summary;
    const results = FILES.map((f) => aggregateFile(f, MAPPING));
    const lib = buildDailySummary(results, '2026-07-29', '2026-07-28');
    assert.deepEqual(inline.totals, lib.totals);
    assert.deepEqual(inline.salesChannels, lib.salesChannels);
    assert.deepEqual(inline.adChannels, lib.adChannels);
    assert.deepEqual(inline.topProducts, lib.topProducts);
  });
});

describe('ワークフローJSONが最新の埋め込み版と同じか', () => {
  const wfPath = path.join(ROOT, 'n8n', 'workflow-6-sales-report.json');

  test('workflow-6 の Code ノードが snippets の内容を含んでいる', () => {
    assert.ok(fs.existsSync(wfPath), 'workflow-6-sales-report.json がありません（npm run build:n8n を実行してください）');
    const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
    const codeNode = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code' && n.name.includes('集計'));
    assert.ok(codeNode, '集計用の Code ノードが見つかりません');

    // 埋め込み時に export を外しているので、そこだけ揃えて比較する
    const snippet = fs
      .readFileSync(path.join(ROOT, 'n8n', 'snippets', 'salesInline.js'), 'utf8')
      .replace(/^export /gm, '');

    assert.ok(
      codeNode.parameters.jsCode.includes(snippet.trim()),
      'ワークフローJSONが古くなっています。npm run build:n8n を実行してください。'
    );
  });
});
