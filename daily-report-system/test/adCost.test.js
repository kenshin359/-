// ============================================================
//  広告費まわりのテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・広告費の金額を読み間違えない
//    ・「結果」列をうっかり注文数として使わない（CPAが狂う）
//    ・キャンペーン名から商品を勝手に決めつけない
//    ・期間まとめのCSVを日別のふりをして取り込まない
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import { readAdFile, detectMedia, isPurchaseIndicator, countDays, MEDIA } from '../lib/adCsv.js';
import {
  classifyChannel,
  classifyProduct,
  classifyCampaign,
  normalizeCampaign,
  productGroup,
} from '../lib/adClassify.js';
import { classifyRows, summarize, formatAdSummary, withRates } from '../lib/adSummary.js';
import { productOptions, toOptions, dedupKey, MEDIA_OPTIONS } from '../kintone/adCostSchema.js';
import { VIEWS, REPORTS } from '../kintone/adCostViews.js';
import { previousDay, previousMonth, flattenRecords } from '../scripts/adReport.js';

const enc = (s) => Buffer.from(s, 'utf8');

const META_JA = [
  'レポート開始日,レポート終了日,キャンペーン名,キャンペーンの配信,結果,結果インジケーター,結果の単価,広告セットの予算,広告セットの予算タイプ,"消化金額 (JPY)",インプレッション数,リーチ,フリークエンシー,リンククリック(ユニーク),終了日時,アトリビューション設定',
  '2026-07-01,2026-07-01,"R  首振り 爆風",active,100,actions:link_click,12.5,広告セット予算を使用,0,"1,250",10000,9000,1.1,100,継続,クリックから7日間',
  '2026-07-01,2026-07-01,"A：Nアルミ：通常",active,20,offsite_conversion.fb_pixel_purchase,25,広告セット予算を使用,0,500,4000,3800,1.05,50,継続,クリックから7日間',
].join('\n');

const META_EN = [
  '"Reporting starts","Reporting ends","Campaign name","Campaign delivery","Amount spent (JPY)","Ad set budget","Ad set budget type",Impressions,"CPM (cost per 1,000 impressions) (JPY)",Reach,Frequency,"CTR (all)","Link clicks","CPC (all) (JPY)","Purchase ROAS (return on ad spend)","Attribution setting",Results,"Result indicator","Cost per results"',
  '2026-07-01,2026-07-30,"R  スケルトン 割引Campaign",active,286369,"Using ad set budget",0,425685,672.7,310481,1.37,5.84,24430,11.5,,"7-day click or 1-day view",24430,actions:link_click,11.7',
].join('\n');

// ── CSV の読み取り ────────────────────────────────

test('Meta広告（日本語）の消化金額とクリック数を正しく読む', () => {
  const r = readAdFile(enc(META_JA), { filename: 'meta.csv' });
  assert.equal(r.media, MEDIA.META);
  assert.equal(r.rows.length, 2);
  // "1,250" のカンマ入りでも数値になる
  assert.equal(r.rows[0].cost, 1250);
  assert.equal(r.rows[0].clicks, 100);
  assert.equal(r.rows[0].impressions, 10000);
});

test('Meta広告（英語）も同じ形に読める', () => {
  const r = readAdFile(enc(META_EN), { filename: 'campaigns.csv' });
  assert.equal(r.media, MEDIA.META);
  assert.equal(r.rows[0].cost, 286369);
  assert.equal(r.rows[0].clicks, 24430);
});

test('★Metaの「結果」がクリックのときは注文数として使わない', () => {
  const r = readAdFile(enc(META_JA), { filename: 'meta.csv' });
  // 1行目は actions:link_click → 注文数は不明のままにする
  assert.equal(r.rows[0].conversions, null);
  // 2行目は購入 → 注文数として採用してよい
  assert.equal(r.rows[1].conversions, 20);
});

test('購入を表すインジケーターだけを注文数とみなす', () => {
  assert.equal(isPurchaseIndicator('offsite_conversion.fb_pixel_purchase'), true);
  assert.equal(isPurchaseIndicator('actions:purchase'), true);
  assert.equal(isPurchaseIndicator('actions:link_click'), false);
  assert.equal(isPurchaseIndicator('actions:omni_landing_page_view'), false);
  assert.equal(isPurchaseIndicator(''), false);
});

test('期間まとめのファイルは isDaily が false になる', () => {
  const r = readAdFile(enc(META_EN), { filename: 'campaigns.csv' });
  assert.equal(r.isDaily, false);
  assert.equal(r.periodStart, '2026-07-01');
  assert.equal(r.periodEnd, '2026-07-30');
});

test('1日だけのファイルは isDaily が true になる', () => {
  const r = readAdFile(enc(META_JA), { filename: 'meta.csv' });
  assert.equal(r.isDaily, true);
});

test('金額が読めない行は捨てる（合計行・空行対策）', () => {
  const csv = [
    '日付,キャンペーン名,実績額,クリック数',
    '2026-07-01,R テストA,1000,10',
    '2026-07-01,合計,,',
  ].join('\n');
  const r = readAdFile(enc(csv), { filename: 'rpp.csv', media: MEDIA.RPP });
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.length, 1);
});

test('媒体をファイル名と見出しから見分ける', () => {
  assert.equal(detectMedia(['レポート開始日', 'アトリビューション設定'], 'x.csv'), MEDIA.META);
  assert.equal(detectMedia(['日付', '実績額'], 'x.csv'), MEDIA.RPP);
  assert.equal(detectMedia(['date', 'cost'], 'google_ads_202607.csv'), MEDIA.GOOGLE);
  assert.equal(detectMedia(['date', 'cost'], 'tiktok_202607.csv'), MEDIA.TIKTOK);
  assert.equal(detectMedia(['date', 'cost'], 'なぞ.csv'), null);
});

test('日数の数え方（両端を含む）', () => {
  assert.equal(countDays('2026-07-01', '2026-07-01'), 1);
  assert.equal(countDays('2026-07-01', '2026-07-30'), 30);
  assert.equal(countDays('2026-07-30', '2026-07-01'), null);
  assert.equal(countDays(null, '2026-07-01'), null);
});

// ── キャンペーン名の判定 ──────────────────────────

test('先頭1文字から販売先を判定する', () => {
  assert.equal(classifyChannel('R  首振り 爆風').channel, '楽天');
  assert.equal(classifyChannel('A：PC 初回広告').channel, 'Amazon');
  assert.equal(classifyChannel('Zミニファン　まとめ').channel, '自社サイト');
  assert.equal(classifyChannel('Ｒ　首振り').channel, '楽天'); // 全角も拾う
});

test('★英単語で始まるキャンペーンを販売先と誤判定しない', () => {
  assert.equal(classifyChannel('Reach拡大テスト').channel, '未分類');
  assert.equal(classifyChannel('Amazon 父の日 キャンペーン').channel, '未分類');
});

test('F は「要確認」のままにする（何を指すか未確認のため）', () => {
  const c = classifyChannel('F PC ファスナー');
  assert.equal(c.confidence, '要確認');
});

test('確実に分かる商品だけを確定にする', () => {
  assert.equal(classifyProduct('R  首振り 爆風').product, 'ハンディファン(首振り)');
  assert.equal(classifyProduct('R  首振り 爆風').confidence, '確定');
  assert.equal(classifyProduct('Z  スケルトン 割引').product, 'ハンディファン(スケルトン)');
  assert.equal(classifyProduct('R：Nアルミ：通常広告').product, 'ノーマルアルミ');
  assert.equal(classifyProduct('Zミニファン　まとめ').product, 'ミニハンディファン');
});

test('★型式が分からないものは勝手に確定させない', () => {
  // アルミ系だが多機能かクラシックか判別できない
  const t = classifyProduct('R　Tアル　717　アルミスーツケースの魅力');
  assert.equal(t.confidence, '要確認');
  // PC(ポリカーボネート)はサイズが分からない
  const pc = classifyProduct('R 　PC 初回広告');
  assert.equal(pc.confidence, '要確認');
  // ファンだがモデルが分からない
  const fan = classifyProduct('R  最近よく見る 「持ち運ぶエアコン」');
  assert.equal(fan.confidence, '要確認');
});

test('★「PC多機能」は「PC」より先に判定される（順番が大事）', () => {
  assert.equal(classifyProduct('R:PC多機能従来北野式').product, '多機能PC');
  assert.equal(classifyProduct('R 　PC 初回広告').product, 'スーツケース(PC)');
});

test('どちらかが要確認なら全体も要確認', () => {
  const c = classifyCampaign('F PC ファスナー');
  assert.equal(c.confidence, '要確認');
  const ok = classifyCampaign('R  首振り 爆風');
  assert.equal(ok.confidence, '確定');
});

test('全角スペース・全角英数を揃える', () => {
  assert.equal(normalizeCampaign('Ｒ　首振り　爆風'), 'R 首振り 爆風');
});

test('商品からカテゴリを引ける', () => {
  assert.equal(productGroup('ハンディファン(首振り)'), 'ファン');
  assert.equal(productGroup('ノーマルアルミ'), 'スーツケース');
  assert.equal(productGroup('存在しない商品'), '');
});

// ── 集計 ──────────────────────────────────────────

test('商品別・媒体別・販売先別の合計が一致する', () => {
  const rows = classifyRows([
    { media: 'Meta広告', campaign: 'R  首振り', cost: 1000, clicks: 100, impressions: 10000, conversions: null, revenue: 5000 },
    { media: 'Meta広告', campaign: 'A  首振り', cost: 500, clicks: 50, impressions: 5000, conversions: 2, revenue: 3000 },
    { media: 'RPP(楽天)', campaign: 'R  スケルトン', cost: 2000, clicks: 200, impressions: 20000, conversions: 5, revenue: 9000 },
  ]);
  const s = summarize(rows);
  assert.equal(s.total.cost, 3500);
  assert.equal(s.byMedia.reduce((a, b) => a + b.cost, 0), 3500);
  assert.equal(s.byProduct.reduce((a, b) => a + b.cost, 0), 3500);
  assert.equal(s.byChannel.reduce((a, b) => a + b.cost, 0), 3500);
  // 金額の大きい順に並ぶ
  assert.equal(s.byMedia[0].name, 'RPP(楽天)');
});

test('★広告費0でも割り算で壊れない', () => {
  const s = summarize(classifyRows([{ media: 'Meta広告', campaign: 'R  首振り', cost: 0, clicks: 0, impressions: 0, conversions: 0, revenue: 0 }]));
  const r = withRates(s.total);
  assert.equal(r.cpc, null);
  assert.equal(r.cpa, null);
  assert.equal(r.cpm, null);
  assert.equal(r.roas, null);
  assert.doesNotThrow(() => formatAdSummary(s, { title: 'テスト' }));
});

test('要確認の広告費だけを別に集計する', () => {
  const rows = classifyRows([
    { media: 'Meta広告', campaign: 'R  首振り', cost: 1000 },
    { media: 'Meta広告', campaign: 'R 　PC 初回広告', cost: 4000 },
  ]);
  const s = summarize(rows);
  assert.equal(s.uncertainCost, 4000);
  assert.equal(s.needsCheck.length, 1);
  const text = formatAdSummary(s, { title: 'テスト' });
  assert.match(text, /要確認/);
});

test('報告文に総広告費・媒体別・商品別が入る', () => {
  const s = summarize(classifyRows([{ media: 'Meta広告', campaign: 'R  首振り', cost: 1234, clicks: 10 }]));
  const text = formatAdSummary(s, { title: '昨日の広告費', periodLabel: '2026-07-29' });
  assert.match(text, /昨日の広告費/);
  assert.match(text, /総広告費　¥1,234/);
  assert.match(text, /【媒体別】/);
  assert.match(text, /【商品別】/);
});

// ── kintone アプリの定義 ──────────────────────────

test('媒体の選択肢に、社長のご指定の5媒体がすべて入っている', () => {
  for (const m of ['Meta広告', 'Amazon広告', 'RPP(楽天)', 'Google広告', 'TikTok広告']) {
    assert.ok(MEDIA_OPTIONS.includes(m), `${m} が選択肢にありません`);
  }
});

test('商品の選択肢が2つの対応表から作られる', () => {
  const opts = productOptions();
  assert.ok(opts.includes('スーツケースS')); // 売上側の対応表から
  assert.ok(opts.includes('多機能PC')); // 広告側の対応表から
  assert.ok(opts.includes('全体・ブランド'));
  assert.ok(opts.includes('未分類'));
  // 重複が無いこと
  assert.equal(new Set(opts).size, opts.length);
});

test('選択肢の index が0から順に振られる', () => {
  const o = toOptions(['あ', 'い', 'う']);
  assert.equal(o['あ'].index, '0');
  assert.equal(o['う'].index, '2');
});

test('重複防止キーは日付そのもの（1日1レコード）', () => {
  assert.equal(dedupKey('2026-07-29'), '2026-07-29');
});

test('★一覧の絞り込みが kintone の日付関数を使っている（毎月の書き換え不要）', () => {
  assert.equal(VIEWS['昨日'].filterCond, 'report_date = YESTERDAY()');
  assert.equal(VIEWS['今月'].filterCond, 'report_date = THIS_MONTH()');
  assert.equal(VIEWS['先月'].filterCond, 'report_date = LAST_MONTH()');
});

test('★棒・縦棒グラフには chartMode が必須（無いと kintone が拒否する）', () => {
  for (const [name, r] of Object.entries(REPORTS)) {
    if (r.chartType === 'BAR' || r.chartType === 'COLUMN') {
      assert.ok(r.chartMode, `${name} に chartMode がありません`);
    }
    // sorts はグラフ追加時の必須項目
    assert.ok(r.sorts, `${name} に sorts がありません`);
  }
});

test('グラフに「今月の総額」「昨日の総額」「商品別」「媒体別」がある', () => {
  assert.ok(REPORTS['今月の総広告費']);
  assert.ok(REPORTS['昨日の総広告費']);
  assert.equal(REPORTS['今月 商品別の広告費'].groups[0].code, 'd_product');
  assert.equal(REPORTS['今月 媒体別の広告費'].groups[0].code, 'd_media');
});

// ── レポート ──────────────────────────────────────

test('前日・前月の計算', () => {
  assert.equal(previousDay('2026-07-01'), '2026-06-30');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
  assert.equal(previousMonth('2026-07'), '2026-06');
  assert.equal(previousMonth('2026-01'), '2025-12');
});

test('kintoneのレコードを1行=1明細に開く', () => {
  const rows = flattenRecords([
    {
      report_date: { value: '2026-07-29' },
      detail: {
        value: [
          { value: { d_media: { value: 'Meta広告' }, d_product: { value: 'ハンディファン(首振り)' }, d_channel: { value: '楽天' }, d_cost: { value: '1000' }, d_clicks: { value: '10' } } },
          { value: { d_media: { value: 'RPP(楽天)' }, d_product: { value: 'ノーマルアルミ' }, d_channel: { value: '楽天' }, d_cost: { value: '2000' } } },
        ],
      },
    },
    // 日付が空のレコードは無視する
    { detail: { value: [{ value: { d_cost: { value: '999' } } }] } },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cost, 1000);
  assert.equal(rows[1].cost, 2000);
  assert.equal(rows[0].group, 'ファン');
  assert.equal(rows[1].group, 'スーツケース');
});

test('空の明細でも落ちない', () => {
  assert.deepEqual(flattenRecords([{ report_date: { value: '2026-07-29' } }]), []);
  assert.deepEqual(flattenRecords([]), []);
});
