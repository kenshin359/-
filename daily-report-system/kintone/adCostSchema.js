// ============================================================
//  広告費管理アプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = 1日。
//  その中のテーブル（明細）に「媒体 × 商品 × 広告費」を並べます。
//
//  なぜこの形にしたか:
//    ・入力画面が「その日の広告費シート」1枚になる（社長のご要望）
//    ・上に総広告費が自動で出る（明細の合計＝計算式）
//    ・商品ごと・媒体ごとの集計はグラフ側で自動で出せる
//
//  対象媒体:
//    Meta広告 / Amazon広告 / RPP(楽天) / Google広告 / TikTok広告 / その他
//
//  ★売上との突き合わせ（ROASの全社集計）はここではやりません。
//    このアプリは「広告側の実績」を素直に記録するだけにして、
//    突き合わせはダッシュボードと日次レポート側（JS）で行います。
//    計算式をアプリに埋め込むと、後から定義を変えづらくなるためです。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export const APP_NAME = '広告費記載/全て';

/**
 * ブランド（事業）の選択肢。
 * 1つの部屋（アプリ）に全ブランドの広告費をまとめて記載し、
 * グラフでブランドごと・媒体ごとに自動集計します。
 */
export const BRAND_OPTIONS = ['リベティ', 'O2', 'ガジェティ'];

/**
 * 媒体の選択肢。
 * ★CSV自動取込・集計コードは正式名（Meta広告 / RPP(楽天) など）を使うため、
 *   ここでは正式名を維持します（画面上の表示名になります）。
 *   「メタ広告」＝Meta広告、「RPP」＝RPP(楽天)、「Amazon」＝Amazon広告 です。
 * ★「案件依頼」(インフルエンサー等のPR案件) と「PRタイムズ」は広告費として
 *   手入力で記載する枠です（CSVの自動取込対象ではありません）。
 */
export const MEDIA_OPTIONS = [
  'Meta広告',
  'Google広告',
  'RPP(楽天)',
  'Amazon広告',
  'TikTok広告',
  '案件依頼',
  'PRタイムズ',
  'その他',
];

/**
 * ブランドごとに使う媒体の目安（入力の手引き）。
 *   リベティ … メタ広告 / RPP / Amazon / TikTok / 案件依頼 / PRタイムズ
 *   O2      … Google広告 / メタ広告 / 案件依頼
 *   ガジェティ … メタ広告 / 案件依頼
 * ※ kintoneのドロップダウンはブランド連動にできないため、
 *   媒体は全ブランド共通の選択肢にしています。目安として config/brand-media.json に定義。
 */

/** 販売先の選択肢 */
export const CHANNEL_OPTIONS = ['楽天', 'Amazon', '自社サイト', 'TikTok Shop', '共通', '未分類'];

/**
 * 商品の選択肢を作る。
 * 既存の商品対応表（売上側）と、広告キャンペーンの対応表を合わせます。
 * ★2つの表から作るので、商品を増やしたときに片方だけ直し忘れても
 *   もう片方から拾えます。
 */
export function productOptions() {
  const names = new Set();

  const aliases = JSON.parse(
    readFileSync(join(HERE, '..', 'config', 'product-aliases.json'), 'utf8')
  );
  for (const p of aliases.products ?? []) names.add(p.canonical);

  const adRules = JSON.parse(
    readFileSync(join(HERE, '..', 'config', 'ad-campaign-rules.json'), 'utf8')
  );
  for (const p of adRules.products ?? []) names.add(p.canonical);

  // 商品を1つに決めない広告（ブランド広告・イベント広告など）用
  names.add('全体・ブランド');
  names.add('未分類');

  return [...names];
}

/** 選択肢の配列を kintone の options 形式にする */
export function toOptions(list) {
  const o = {};
  list.forEach((label, i) => {
    o[label] = { label, index: String(i) };
  });
  return o;
}

/** 明細テーブルの中身 */
export function detailFields() {
  return {
    d_brand: {
      type: 'DROP_DOWN', code: 'd_brand', label: 'ブランド', required: false,
      options: toOptions(BRAND_OPTIONS),
      defaultValue: 'リベティ',
    },
    d_media: {
      type: 'DROP_DOWN', code: 'd_media', label: '媒体', required: true,
      options: toOptions(MEDIA_OPTIONS),
    },
    d_product: {
      type: 'DROP_DOWN', code: 'd_product', label: '商品', required: false,
      options: toOptions(productOptions()),
      defaultValue: '未分類',
    },
    d_channel: {
      type: 'DROP_DOWN', code: 'd_channel', label: '販売先', required: false,
      options: toOptions(CHANNEL_OPTIONS),
    },
    d_campaign: {
      type: 'SINGLE_LINE_TEXT', code: 'd_campaign', label: 'キャンペーン名', required: false,
    },
    d_cost: {
      type: 'NUMBER', code: 'd_cost', label: '広告費', required: true,
      unit: '円', unitPosition: 'AFTER', digit: true, defaultValue: '0',
    },
    d_impressions: {
      type: 'NUMBER', code: 'd_impressions', label: '表示回数', required: false, digit: true,
    },
    d_clicks: {
      type: 'NUMBER', code: 'd_clicks', label: 'クリック数', required: false, digit: true,
    },
    d_conversions: {
      type: 'NUMBER', code: 'd_conversions', label: '注文数', required: false, digit: true,
    },
    d_revenue: {
      type: 'NUMBER', code: 'd_revenue', label: '広告経由売上', required: false,
      unit: '円', unitPosition: 'AFTER', digit: true,
    },
    // 広告費0の日に「0で割る」エラーが出ないよう、必ず分岐を入れる
    d_cpc: {
      type: 'CALC', code: 'd_cpc', label: 'クリック単価', required: false,
      expression: 'IF(d_clicks > 0, d_cost / d_clicks, 0)',
      format: 'NUMBER_DIGIT', unit: '円', unitPosition: 'AFTER',
    },
    d_roas: {
      type: 'CALC', code: 'd_roas', label: 'ROAS', required: false,
      expression: 'IF(d_cost > 0, d_revenue / d_cost, 0)',
      format: 'NUMBER', displayScale: '2',
    },
  };
}

export const FIELDS = {
  report_date: {
    type: 'DATE', code: 'report_date', label: '日付', required: true,
    defaultNowValue: true,
  },

  // 明細の合計。入力画面の一番上に出るので、その日の総広告費がすぐ分かる。
  total_cost: {
    type: 'CALC', code: 'total_cost', label: '総広告費（自動計算）', required: false,
    expression: 'SUM(d_cost)',
    format: 'NUMBER_DIGIT', unit: '円', unitPosition: 'AFTER',
  },
  total_clicks: {
    type: 'CALC', code: 'total_clicks', label: 'クリック合計（自動計算）', required: false,
    expression: 'SUM(d_clicks)', format: 'NUMBER_DIGIT',
  },
  total_conversions: {
    type: 'CALC', code: 'total_conversions', label: '注文数合計（自動計算）', required: false,
    expression: 'SUM(d_conversions)', format: 'NUMBER_DIGIT',
  },

  detail: {
    type: 'SUBTABLE', code: 'detail', label: '広告費 明細（媒体 × 商品）',
    fields: detailFields(),
  },

  source: {
    type: 'DROP_DOWN', code: 'source', label: '入力方法', required: false,
    options: toOptions(['手入力', 'CSV取込']),
    defaultValue: '手入力',
  },
  note: {
    type: 'MULTI_LINE_TEXT', code: 'note', label: '備考', required: false,
  },

  // 同じ日を二重に登録しないための鍵（1日1レコード）
  dedup_key: {
    type: 'SINGLE_LINE_TEXT', code: 'dedup_key', label: '重複防止キー',
    required: false, unique: true,
  },
};

/** 重複防止キー（1日1レコードなので日付そのもの） */
export function dedupKey(dateISO) {
  return String(dateISO);
}
