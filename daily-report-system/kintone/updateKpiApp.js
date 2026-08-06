#!/usr/bin/env node
// ============================================================
//  毎朝KPI報告アプリ（ID30）の入力欄を改良する
// ------------------------------------------------------------
//  目的: 「人が迷わず添付できて、Claudeが確実に読める」形にする。
//
//  やること（既存データは一切消しません。欄の追加とラベル改善だけ）:
//    ① 📎在庫レポート欄を新設（在庫の出どころを1本化するため）
//    ② 添付欄のラベルに「ファイル名の付け方」を明記
//       → 媒体名を頭に付けてもらうと自動読取りの精度が上がる
//
//  対象は自分たちで作ったKPIアプリのみ。
//  売上・転換率報告アプリ（ID7・手入力）には一切触りません。
// ============================================================
import { call } from '../lib/intake.js';
import { optional } from '../lib/env.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitDeploy(app) {
  for (let i = 0; i < 30; i++) {
    const r = await call('GET', `/k/v1/preview/app/deploy.json?apps[0]=${app}`);
    const st = r.apps?.[0]?.status;
    if (st === 'SUCCESS') return;
    if (st === 'FAIL' || st === 'CANCEL') throw new Error(`デプロイ失敗: ${st}`);
    await sleep(2000);
  }
  throw new Error('デプロイがタイムアウトしました');
}

async function main() {
  const app = optional('KINTONE_KPI_APP_ID', '30');
  const cur = await call('GET', `/k/v1/app/form/fields.json?app=${app}`);
  const props = cur.properties ?? {};
  console.log(`アプリ${app}: 現在のフィールド ${Object.keys(props).length}個`);

  // ① 新しい欄（無いものだけ追加）
  const wanted = {
    file_stock: {
      type: 'FILE',
      code: 'file_stock',
      label: '📎 在庫レポート（カラー別在庫のスクショ・CSV）',
    },
  };
  const toAdd = Object.fromEntries(Object.entries(wanted).filter(([code]) => !props[code]));
  if (Object.keys(toAdd).length) {
    await call('POST', '/k/v1/preview/app/form/fields.json', { app, properties: toAdd });
    console.log(`追加: ${Object.keys(toAdd).join(', ')}`);
  } else {
    console.log('追加する欄はありません（設定済み）');
  }

  // ② ラベル改善（ファイル名ルールを欄に直接書いておく）
  const relabel = {};
  const setLabel = (code, label) => {
    if (props[code] && props[code].label !== label) {
      relabel[code] = { type: props[code].type, code, label };
    }
  };
  setLabel('file_ads', '📎 広告費レポート（ファイル名の頭に google_ / rakuten_ / amazon_ / meta_ を付ける）');
  setLabel('file_sales', '📎 売上レポート（Amazonは「日付別」でダウンロードしたCSV）');
  setLabel('file_other', '📎 その他（アクセス・転換率・メモなど何でも）');
  if (Object.keys(relabel).length) {
    await call('PUT', '/k/v1/preview/app/form/fields.json', { app, properties: relabel });
    console.log(`ラベル更新: ${Object.keys(relabel).join(', ')}`);
  } else {
    console.log('ラベルは最新です');
  }

  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app }] });
  await waitDeploy(app);
  console.log('✅ 反映完了（既存レコード・入力済みデータはそのまま）');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
