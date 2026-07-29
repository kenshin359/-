// ============================================================
//  広告費アプリ  フィールド定義
// ------------------------------------------------------------
//  1レコード = 1日 × 1媒体 の広告実績。
//
//  なぜ媒体ごとに分けるのか:
//    ・媒体別の ROAS を出すため（合算では止めるべき媒体が分からない）
//    ・媒体ごとに取得方法も更新タイミングも違うため
//
//  対象媒体: Meta広告 / RPP(楽天) / Amazon広告 / Google広告
//
//  ★売上との突き合わせは Kintone 側では行いません。
//    このアプリは「広告側の実績」を素直に記録するだけにして、
//    ROAS の計算はダッシュボード側（JS）で行います。
//    計算式をアプリに埋めると、後から定義を変えづらくなるためです。
// ============================================================

export const APP_NAME = '広告費';

export const FIELDS = {
  report_date: {
    type: 'DATE', code: 'report_date', label: '日付', required: true,
    defaultNowValue: true,
  },
  media: {
    type: 'DROP_DOWN', code: 'media', label: '媒体', required: true,
    options: {
      'Meta広告': { label: 'Meta広告', index: '0' },
      'RPP(楽天)': { label: 'RPP(楽天)', index: '1' },
      'Amazon広告': { label: 'Amazon広告', index: '2' },
      'Google広告': { label: 'Google広告', index: '3' },
      'その他': { label: 'その他', index: '4' },
    },
  },
  // 媒体の中の内訳（RPPとクーポンアドバンス、Amazonのスポンサープロダクト等）
  campaign: {
    type: 'SINGLE_LINE_TEXT', code: 'campaign', label: 'キャンペーン/種別', required: false,
  },

  // ── 実績 ──
  cost: {
    type: 'NUMBER', code: 'cost', label: '広告費', required: true,
    unit: '円', unitPosition: 'AFTER', digit: true,
  },
  impressions: {
    type: 'NUMBER', code: 'impressions', label: '表示回数', required: false, digit: true,
  },
  clicks: {
    type: 'NUMBER', code: 'clicks', label: 'クリック数', required: false, digit: true,
  },
  conversions: {
    type: 'NUMBER', code: 'conversions', label: '注文数', required: false, digit: true,
  },
  conversion_value: {
    type: 'NUMBER', code: 'conversion_value', label: '広告経由売上', required: false,
    unit: '円', unitPosition: 'AFTER', digit: true,
  },

  // ── 媒体内で完結する指標だけを計算式にする ──
  // ROAS は「広告経由売上 ÷ 広告費」。広告費0の日に壊れないよう分岐を入れる。
  roas: {
    type: 'CALC', code: 'roas', label: 'ROAS', required: false,
    expression: 'IF(cost > 0, conversion_value / cost, 0)',
    format: 'NUMBER', displayScale: '2',
  },
  cpc: {
    type: 'CALC', code: 'cpc', label: 'クリック単価', required: false,
    expression: 'IF(clicks > 0, cost / clicks, 0)',
    format: 'NUMBER_DIGIT', unit: '円', unitPosition: 'AFTER',
  },
  cpa: {
    type: 'CALC', code: 'cpa', label: '注文獲得単価', required: false,
    expression: 'IF(conversions > 0, cost / conversions, 0)',
    format: 'NUMBER_DIGIT', unit: '円', unitPosition: 'AFTER',
  },

  note: {
    type: 'MULTI_LINE_TEXT', code: 'note', label: '備考', required: false,
  },

  // 同じ日・同じ媒体・同じキャンペーンを二重登録しないための鍵
  dedup_key: {
    type: 'SINGLE_LINE_TEXT', code: 'dedup_key', label: '重複防止キー',
    required: false, unique: true,
  },
};

/** 重複防止キーを組み立てる */
export function dedupKey(dateISO, media, campaign = '') {
  return `${dateISO}__${media}__${campaign}`;
}
