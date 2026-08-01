// ============================================================
//  n8n版 Shopify連携のテスト
// ------------------------------------------------------------
//  n8n の中には SKU対応表を「もう1つ」書き写しています。
//  n8n からは config/sku-map.json を読めないためです。
//
//  ★2か所にあるものは、いつか必ずズレます。
//    ズレると n8n だけが古い商品名で登録し続け、誰も気づきません。
//    そうならないよう、ここで一致を強制します。
//    sku-map.json を直したら、n8n の SKU_MAP も直してください。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_PATH = join(HERE, '..', 'n8n', 'workflow-7-shopify-sales.json');
const MAP_PATH = join(HERE, '..', 'config', 'sku-map.json');

const workflow = JSON.parse(readFileSync(WF_PATH, 'utf8'));

function nodeByName(name) {
  return workflow.nodes.find((n) => n.name === name);
}

/** n8n のコードノードから SKU_MAP の中身を取り出す */
function embeddedSkuMap() {
  const code = nodeByName('商品ごとにまとめる').parameters.jsCode;
  const m = code.match(/const SKU_MAP = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'SKU_MAP の定義が見つかりません');
  // 自分たちが書いたファイルの中身なので、その場で評価して読み取る
  return new Function(`return ${m[1]}`)();
}

test('n8n の SKU対応表が、config/sku-map.json と一致している', () => {
  const embedded = embeddedSkuMap();
  const json = JSON.parse(readFileSync(MAP_PATH, 'utf8'));

  const expected = {};
  for (const e of json.entries ?? []) {
    if (e.sku && e.product) expected[String(e.sku).trim().toUpperCase()] = e.product;
  }

  const missing = Object.keys(expected).filter((k) => embedded[k] !== expected[k]);
  const extra = Object.keys(embedded).filter((k) => !(k in expected));

  assert.deepEqual(
    missing,
    [],
    `n8n の SKU_MAP に足りない／違うSKU: ${missing.map((k) => `${k}→${expected[k]}`).join(', ')}`
  );
  assert.deepEqual(extra, [], `n8n の SKU_MAP に余計なSKU: ${extra.join(', ')}`);
});

test('日付は日本時間で作っている（UTCのままだと前日にずれる）', () => {
  const code = nodeByName('対象日を決める').parameters.jsCode;
  assert.ok(code.includes('9 * 60 * 60 * 1000'), '日本時間への補正が入っていること');
  assert.ok(code.includes("+09:00"), '検索条件も日本時間で指定していること');
});

test('★他の販売先の明細を消していない（Amazon・楽天が消えると大事故）', () => {
  const code = nodeByName('キントーン用に組み立てる').parameters.jsCode;
  assert.ok(
    code.includes("s_channel.value !== '自社サイト'"),
    '自社サイト以外の明細を残す処理があること'
  );
  assert.ok(code.includes('kept.concat(newRows)'), '残した明細に足していること');
});

test('対応表に無いSKUを勝手に断定していない', () => {
  const code = nodeByName('商品ごとにまとめる').parameters.jsCode;
  assert.ok(code.includes("mapped ? '確定' : '要確認'"), '未登録は要確認になること');
});

test('キャンセルとテスト注文を除いている', () => {
  const code = nodeByName('商品ごとにまとめる').parameters.jsCode;
  assert.ok(code.includes('o.cancelledAt'), 'キャンセルを除外していること');
  assert.ok(code.includes('o.test'), 'テスト注文を除外していること');
});

test('税込・税別の切り替えが入っている', () => {
  const code = nodeByName('商品ごとにまとめる').parameters.jsCode;
  assert.ok(code.includes('taxesIncluded'), '店舗の税設定を見ていること');
  assert.ok(code.includes('taxIncluded ? base : base + tax'), '税別のときだけ税を足すこと');
});

test('つなぎ先のノードがすべて存在する', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const [src, c] of Object.entries(workflow.connections)) {
    assert.ok(names.has(src), `つなぎ元が無い: ${src}`);
    for (const branch of c.main ?? []) {
      for (const t of branch) assert.ok(names.has(t.node), `つなぎ先が無い: ${t.node}`);
    }
  }
});

test('タイムゾーンが日本になっている', () => {
  assert.equal(workflow.settings.timezone, 'Asia/Tokyo');
});
