// ============================================================
//  キャンペーン名から「販売先」と「商品」を読み取る
// ------------------------------------------------------------
//  広告の管理画面には、商品コードのような正しい欄がありません。
//  実際に頼れるのはキャンペーン名だけです。
//    例) 「R  首振り 爆風過ぎて笑う Campaign」
//         R = 楽天 ／ 首振り = ハンディファン(首振り)
//
//  ★確実に分かるものだけ『確定』にします。
//    判断がつかないものは『要確認』のまま残し、勝手にまとめません。
//    広告費を違う商品に付けると、赤字の商品を黒字と誤解するためです。
//
//  対応表は config/ad-campaign-rules.json にあります。
//  プログラムを触らずに、そちらを直すだけで判定を変えられます。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(HERE, '..', 'config', 'ad-campaign-rules.json');

let cached = null;

/** 対応表を読む（1回読んだら使い回す） */
export function loadRules(path = RULES_PATH) {
  if (cached && path === RULES_PATH) return cached;
  const rules = JSON.parse(readFileSync(path, 'utf8'));
  if (path === RULES_PATH) cached = rules;
  return rules;
}

/** テスト用: 読み込んだ対応表を捨てる */
export function clearRulesCache() {
  cached = null;
}

/** 全角スペース・全角英数を半角に揃える（「Ｒ　首振り」対策） */
export function normalizeCampaign(name) {
  return String(name ?? '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[　 ]/g, ' ')
    .trim();
}

/**
 * 先頭1文字から販売先を判定する。
 * 「R  首振り」「R：PC」「Zミニファン」のどれでも取れるようにします。
 * ★英単語（Reach など）を誤判定しないよう、次が英字なら対象外にします。
 */
export function classifyChannel(campaignName, rules = loadRules()) {
  const name = normalizeCampaign(campaignName);
  const m = name.match(/^([A-Za-z])(?![A-Za-z])/);
  if (!m) return { channel: rules.unknown_channel, confidence: '要確認' };

  const letter = m[1].toUpperCase();
  const hit = (rules.channels ?? []).find((c) => c.prefix.toUpperCase() === letter);
  if (!hit) return { channel: rules.unknown_channel, confidence: '要確認' };
  return { channel: hit.channel, confidence: hit.confidence ?? '確定', note: hit.note };
}

/**
 * キーワードから商品を判定する。
 * 対応表の上から順に見て、最初に当たったものを採用します。
 * （「PC多機能」を「PC」より先に書いてあるのはそのためです）
 */
export function classifyProduct(campaignName, rules = loadRules()) {
  const name = normalizeCampaign(campaignName);
  const upper = name.toUpperCase();

  for (const p of rules.products ?? []) {
    for (const kw of p.keywords ?? []) {
      const k = normalizeCampaign(kw).toUpperCase();
      if (k && upper.includes(k)) {
        return {
          product: p.canonical,
          group: p.group ?? '',
          confidence: p.confidence ?? '確定',
          matched: kw,
          note: p.note,
        };
      }
    }
  }
  return { product: rules.unknown_product, group: '', confidence: '要確認', matched: null };
}

let groupIndex = null;

/**
 * 商品名からカテゴリ（ファン／スーツケース など）を引く。
 * 売上側の対応表と広告側の対応表、両方から作ります。
 */
export function productGroup(productName) {
  if (!groupIndex) {
    groupIndex = new Map();
    const load = (file) => {
      try {
        const j = JSON.parse(readFileSync(join(HERE, '..', 'config', file), 'utf8'));
        for (const p of j.products ?? []) {
          if (p.canonical && p.group) groupIndex.set(p.canonical, p.group);
        }
      } catch {
        // 対応表が無くても集計は続けられる（カテゴリが空になるだけ）
      }
    };
    load('product-aliases.json');
    load('ad-campaign-rules.json');
  }
  return groupIndex.get(productName) ?? '';
}

/** テスト用: カテゴリ表を捨てる */
export function clearGroupCache() {
  groupIndex = null;
}

/** 販売先と商品をまとめて判定する */
export function classifyCampaign(campaignName, rules = loadRules()) {
  const ch = classifyChannel(campaignName, rules);
  const pr = classifyProduct(campaignName, rules);
  return {
    campaign: normalizeCampaign(campaignName),
    channel: ch.channel,
    channelConfidence: ch.confidence,
    product: pr.product,
    group: pr.group,
    productConfidence: pr.confidence,
    matched: pr.matched,
    note: pr.note,
    // 販売先と商品の両方が確定して初めて「確定」とみなす
    confidence: ch.confidence === '確定' && pr.confidence === '確定' ? '確定' : '要確認',
  };
}
