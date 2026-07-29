// ============================================================
//  売上レポートのテスト
// ------------------------------------------------------------
//  金額を扱うので、ここは特に厚めに検証します。
//  「1円でもずれたら気づける」ことを目標にしています。
// ============================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, readTable, decodeText, detectDelimiter, normalizeHeader } from '../lib/csv.js';
import { parseAmount, parseDate, yen, deltaPct, formatDelta } from '../lib/salesValues.js';
import { detectChannel, pickColumn, aggregateFile, buildDailySummary } from '../lib/salesAggregate.js';
import { formatSalesSummary } from '../lib/salesFormat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples', 'sales');
const MAPPING = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'sales-mapping.json'), 'utf8'));

function sample(name) {
  return { name, buffer: fs.readFileSync(path.join(SAMPLES, name)) };
}

describe('CSVの読み込み', () => {
  test('引用符の中のカンマは区切りとして扱わない', () => {
    const rows = parseCsv('a,b\n"1,234",x\n');
    assert.deepEqual(rows, [
      ['a', 'b'],
      ['1,234', 'x'],
    ]);
  });

  test('引用符の中の改行を1つの値として保つ', () => {
    const rows = parseCsv('a,b\n"1行目\n2行目",x\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[1][0], '1行目\n2行目');
  });

  test('"" はひとつの " として読む', () => {
    const rows = parseCsv('a\n"12""34"\n');
    assert.equal(rows[1][0], '12"34');
  });

  test('CRLF（Windows形式）でも行がずれない', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    assert.deepEqual(rows, [
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  test('末尾に改行が無くても最終行を落とさない', () => {
    const rows = parseCsv('a,b\n1,2');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], ['1', '2']);
  });

  test('タブ区切りを自動判別する', () => {
    assert.equal(detectDelimiter('a\tb\tc\n'), '\t');
    assert.equal(detectDelimiter('a,b,c\n'), ',');
  });

  test('見出しのゆらぎ（全角・空白・大文字）を吸収する', () => {
    assert.equal(normalizeHeader(' 商品　名 '), '商品名');
    assert.equal(normalizeHeader('ＡＭＯＵＮＴ'), 'amount');
  });
});

describe('文字コードの判定', () => {
  test('UTF-8 BOM 付きを読める（Excelが付けるもの）', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('日付,金額', 'utf8')]);
    const { text, encoding } = decodeText(buf);
    assert.equal(encoding, 'utf-8-bom');
    assert.equal(text, '日付,金額');
  });

  test('Shift_JIS のファイルを文字化けさせずに読む', () => {
    // 楽天サンプルは実際に Shift_JIS で保存してある
    const { encoding } = decodeText(fs.readFileSync(path.join(SAMPLES, 'rakuten_sample.csv')));
    assert.equal(encoding, 'shift_jis');

    const { headers, rows } = readTable(sample('rakuten_sample.csv').buffer);
    assert.ok(headers.includes('受注日'), `見出しが化けている: ${headers.join(',')}`);
    assert.equal(rows[0]['商品名'], 'ドライヤー ブラック');
  });

  test('UTF-8 のファイルは UTF-8 と判定する', () => {
    const { encoding } = decodeText(fs.readFileSync(path.join(SAMPLES, 'amazon_sample.csv')));
    assert.equal(encoding, 'utf-8');
  });
});

describe('金額の読み取り', () => {
  const cases = [
    ['1234', 1234],
    ['1,234', 1234],
    ['¥1,234', 1234],
    ['￥1,234', 1234],
    ['1,234円', 1234],
    ['JPY 1234', 1234],
    ['1234.50', 1234.5],
    ['(1,234)', -1234], // 会計表記のカッコはマイナス
    ['-1,234', -1234],
    ['△1,234', -1234],
    ['▲1,234', -1234],
    ['１２３４', 1234], // 全角
    ['12点', 12],
    ['', null],
    ['-', null],
    ['N/A', null],
    ['なし', null],
    ['未計上', null],
    ['abc', null],
    [null, null],
    [1234, 1234],
  ];

  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(parseAmount(input), expected);
    });
  }
});

describe('日付の読み取り', () => {
  const cases = [
    ['2026/07/29', '2026-07-29'],
    ['2026-07-29', '2026-07-29'],
    ['2026.7.9', '2026-07-09'],
    ['20260729', '2026-07-29'],
    ['2026年7月29日', '2026-07-29'],
    ['2026年07月29日 13:45', '2026-07-29'],
    ['2026-07-29T13:45:00+09:00', '2026-07-29'],
    ['2026/07/29 13:45:00', '2026-07-29'],
    ['07/29/2026', '2026-07-29'], // 英語レポート
    ['', null],
    ['ごうけい', null],
    ['2026-13-01', null], // 13月は無効
  ];

  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(parseDate(input), expected);
    });
  }
});

describe('列の選び方', () => {
  test('完全一致を優先する', () => {
    const headers = ['日付', '消化金額', '消化金額(jpy)'];
    assert.equal(pickColumn(headers, ['消化金額']), '消化金額');
  });

  test('完全一致が無ければ部分一致で拾う', () => {
    const headers = ['日', '消化金額(jpy)'];
    assert.equal(pickColumn(headers, ['消化金額']), '消化金額(jpy)');
  });

  test('候補がどれも無ければ null', () => {
    assert.equal(pickColumn(['日付', '件数'], ['売上金額', '小計']), null);
  });
});

describe('媒体の判別', () => {
  test('ファイル名から媒体を当てる', () => {
    assert.equal(detectChannel('amazon_2026-07.csv', MAPPING).id, 'amazon');
    assert.equal(detectChannel('楽天_受注.csv', MAPPING).id, 'rakuten');
    assert.equal(detectChannel('META_ADS.CSV', MAPPING).id, 'meta'); // 大文字でもよい
    assert.equal(detectChannel('rpp.tsv', MAPPING).id, 'rpp');
  });

  test('判別できないファイルは null（無視せず理由を返させる）', () => {
    assert.equal(detectChannel('売上.csv', MAPPING), null);
  });

  test('判別できないファイルは ok:false と理由を返す', () => {
    const r = aggregateFile({ name: 'なぞ.csv', buffer: Buffer.from('a,b\n1,2\n') }, MAPPING);
    assert.equal(r.ok, false);
    assert.match(r.reason, /媒体を判別できません/);
  });

  test('日付の列が無ければ ok:false と理由を返す', () => {
    const r = aggregateFile({ name: 'amazon_x.csv', buffer: Buffer.from('商品名,商品小計\nA,100\n') }, MAPPING);
    assert.equal(r.ok, false);
    assert.match(r.reason, /日付の列が見つかりません/);
  });
});

describe('1ファイルの集計', () => {
  test('Amazon: 日付ごとに売上・注文数・点数を出す', () => {
    const r = aggregateFile(sample('amazon_sample.csv'), MAPPING);
    assert.equal(r.ok, true);
    assert.equal(r.label, 'Amazon');

    // 7/28: 12,800 + 31,600
    assert.equal(r.daily['2026-07-28'].revenue, 44400);
    assert.equal(r.daily['2026-07-28'].orders, 2);
    assert.equal(r.daily['2026-07-28'].units, 3);

    // 7/29: 38,400 + 15,800 + 1,200
    assert.equal(r.daily['2026-07-29'].revenue, 55400);
    // 249-0004 は2行あるが1注文として数える
    assert.equal(r.daily['2026-07-29'].orders, 2);
  });

  test('商品名にカンマが入っていても壊れない', () => {
    const r = aggregateFile(sample('amazon_sample.csv'), MAPPING);
    const p = r.products.find((x) => x.date === '2026-07-29' && x.name.startsWith('ドライヤー'));
    assert.equal(p.name, 'ドライヤー ホワイト, 大風量');
    assert.equal(p.revenue, 38400);
  });

  test('商品別売上が日付をまたいで合算されない（回帰テスト）', () => {
    // 同じ商品が7/28と7/29の両方にある。日付ごとに分かれていること。
    const r = aggregateFile(sample('amazon_sample.csv'), MAPPING);
    const same = r.products.filter((p) => p.name === 'キャリーケース Lサイズ');
    assert.equal(same.length, 2, '日付ごとに分かれていない');
    assert.equal(same.find((p) => p.date === '2026-07-28').revenue, 31600);
    assert.equal(same.find((p) => p.date === '2026-07-29').revenue, 15800);
  });

  test('楽天(Shift_JIS): 金額を正しく合計する', () => {
    const r = aggregateFile(sample('rakuten_sample.csv'), MAPPING);
    assert.equal(r.ok, true);
    assert.equal(r.encoding, 'shift_jis');
    assert.equal(r.daily['2026-07-29'].revenue, 36500); // 27,600 + 8,900
  });

  test('Meta広告: 広告費として読む', () => {
    const r = aggregateFile(sample('meta_ads_sample.csv'), MAPPING);
    assert.equal(r.kind, 'ad');
    assert.equal(r.daily['2026-07-29'].cost, 21900);
    assert.equal(r.daily['2026-07-29'].clicks, 1120);
  });

  test('RPP広告: タブ区切りでも読む', () => {
    const r = aggregateFile(sample('rpp_sample.tsv'), MAPPING);
    assert.equal(r.ok, true);
    assert.equal(r.daily['2026-07-29'].cost, 14200);
  });

  test('日付が読めない行は捨て、件数を報告する', () => {
    const csv = '購入日,注文番号,商品名,数量,商品小計\n' + '合計,,,,99999\n' + '2026/07/29,A-1,商品,1,1000\n';
    const r = aggregateFile({ name: 'amazon_x.csv', buffer: Buffer.from(csv) }, MAPPING);
    assert.equal(r.skipped, 1);
    assert.equal(r.daily['2026-07-29'].revenue, 1000); // 合計行が混ざっていない
  });
});

describe('1日分のまとめ', () => {
  const files = ['amazon_sample.csv', 'rakuten_sample.csv', 'own_site_sample.csv', 'meta_ads_sample.csv', 'rpp_sample.tsv'];
  const results = files.map((f) => aggregateFile(sample(f), MAPPING));
  const summary = buildDailySummary(results, '2026-07-29', '2026-07-28');

  test('総売上は各媒体の合計', () => {
    // Amazon 55,400 + 楽天 36,500 + 自社 14,200
    assert.equal(summary.totals.revenue, 106100);
  });

  test('広告費は広告ファイルだけを合計し、売上には混ぜない', () => {
    assert.equal(summary.totals.adCost, 36100); // Meta 21,900 + RPP 14,200
    const ids = summary.salesChannels.map((c) => c.id);
    assert.ok(!ids.includes('meta') && !ids.includes('rpp'));
  });

  test('ROAS = 売上 ÷ 広告費', () => {
    assert.equal(summary.totals.roas.toFixed(4), (106100 / 36100).toFixed(4));
  });

  test('広告費が0ならROASは出さない（0除算を避ける）', () => {
    const s = buildDailySummary(
      results.filter((r) => r.kind !== 'ad'),
      '2026-07-29',
      '2026-07-28'
    );
    assert.equal(s.totals.roas, null);
  });

  test('客単価 = 売上 ÷ 注文数', () => {
    assert.equal(Math.round(summary.totals.aov), Math.round(106100 / summary.totals.orders));
  });

  test('売れ筋は対象日のものだけを並べる', () => {
    assert.equal(summary.topProducts[0].name, 'ドライヤー ホワイト, 大風量');
    assert.equal(summary.topProducts[0].revenue, 38400);
    // 7/28 だけに出た商品が混ざっていないこと
    assert.ok(!summary.topProducts.some((p) => p.revenue === 31600));
  });

  test('データが1件も無い日でも落ちない', () => {
    const s = buildDailySummary(results, '2020-01-01', '2019-12-31');
    assert.equal(s.totals.revenue, 0);
    assert.equal(s.totals.roas, null);
    assert.equal(s.totals.aov, null);
    assert.doesNotThrow(() => formatSalesSummary(s));
  });
});

describe('表示', () => {
  test('金額に円マークと3桁区切りを付ける', () => {
    assert.equal(yen(1234567), '¥1,234,567');
    assert.equal(yen(-1234), '-¥1,234');
    assert.equal(yen(null), '—');
  });

  test('前日比を計算する。前日0のときは出さない', () => {
    assert.equal(deltaPct(110, 100), 10);
    assert.equal(deltaPct(90, 100), -10);
    assert.equal(deltaPct(100, 0), null);
    assert.equal(formatDelta(8.24), '+8.2%');
    assert.equal(formatDelta(-12.3), '-12.3%');
  });

  test('文面に主要な数字がすべて入る', () => {
    const files = ['amazon_sample.csv', 'rakuten_sample.csv', 'own_site_sample.csv', 'meta_ads_sample.csv', 'rpp_sample.tsv'];
    const results = files.map((f) => aggregateFile(sample(f), MAPPING));
    const summary = buildDailySummary(results, '2026-07-29', '2026-07-28');
    const text = formatSalesSummary(summary);

    assert.match(text, /¥106,100/); // 総売上
    assert.match(text, /Amazon/);
    assert.match(text, /楽天/);
    assert.match(text, /ROAS/);
    assert.match(text, /売れ筋/);
  });

  test('AIコメントは指定した時だけ入る（既定は費用ゼロ）', () => {
    const s = buildDailySummary([], '2026-07-29', '2026-07-28');
    assert.ok(!formatSalesSummary(s).includes('💡'));
    assert.match(formatSalesSummary(s, { comment: '楽天の落ち込みにご注意ください' }), /💡 楽天の落ち込み/);
    // 「特記事項なし」は表示しない（ノイズになるため）
    assert.ok(!formatSalesSummary(s, { comment: '特記事項なし' }).includes('💡'));
  });

  test('読み込めなかったファイルは文面で報告する（黙って落とさない）', () => {
    const bad = aggregateFile({ name: 'なぞ.csv', buffer: Buffer.from('a\n1\n') }, MAPPING);
    const s = buildDailySummary([bad], '2026-07-29', '2026-07-28');
    const text = formatSalesSummary(s);
    assert.match(text, /要確認/);
    assert.match(text, /なぞ\.csv/);
  });
});
