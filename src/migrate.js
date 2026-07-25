// 既存「売上・転換率報告」アプリの文章データを、
// パースして「売上日報（新）」アプリに構造化レコードとして投入する。
//   実行: npm run migrate  （まず DRY_RUN=1 で確認してから本投入を推奨）
import { kintone, qs } from './client.js';
import { parseReport } from './parseReport.js';

const OLD = process.env.KINTONE_OLD_APP_ID;
const NEW = process.env.KINTONE_NEW_APP_ID;
const DRY = process.env.DRY_RUN === '1';

function req(name, v) {
  if (!v) throw new Error(`${name} が未設定です（.env を確認）`);
  return v;
}

// $id カーソルで全レコードを取得
async function fetchAll(app) {
  const all = [];
  let last = 0;
  for (;;) {
    const query = `$id > ${last} order by $id asc limit 100`;
    const r = await kintone('GET', `/k/v1/records.json?${qs({ app, query })}`);
    const recs = r.records || [];
    if (!recs.length) break;
    all.push(...recs);
    last = Number(recs[recs.length - 1].$id.value);
    if (recs.length < 100) break;
  }
  return all;
}

// パース結果 → 新アプリのレコード形式
function toRecord(p) {
  const v = (x) => ({ value: x ?? '' });
  return {
    date: v(p.date),
    sales_rakuten: v(p.sales.rakuten),
    sales_amazon: v(p.sales.amazon),
    sales_own: v(p.sales.own),
    sales_tiktok: v(p.sales.tiktok),
    sales_qoo10: v(p.sales.qoo10),
    sales_base: v(p.sales.base),
    // sales_total は計算フィールドなので送らない（自動算出）
    rk_access: v(p.metrics.rakuten.access),
    rk_cvr: v(p.metrics.rakuten.cvr),
    rk_fav: v(p.metrics.rakuten.fav),
    rk_stay: v(p.metrics.rakuten.stay),
    az_access: v(p.metrics.amazon.access),
    az_cvr: v(p.metrics.amazon.cvr),
    ranking: {
      value: p.ranking.map((x) => ({
        value: {
          mall: { value: ['楽天', 'Amazon', '自社サイト'].includes(x.mall) ? x.mall : '楽天' },
          product: { value: x.product },
          rank: { value: x.rank ?? '' },
          out_of_rank: { value: x.outOfRank ? ['圏外'] : [] },
        },
      })),
    },
  };
}

async function main() {
  req('KINTONE_OLD_APP_ID', OLD);
  req('KINTONE_NEW_APP_ID', NEW);

  console.log(`移行元アプリ ${OLD} を読み込み中 …`);
  const oldRecords = await fetchAll(OLD);
  console.log(`  ${oldRecords.length} レコード取得`);

  // 各レコードの全フィールドを走査し、報告文らしき文字列をすべてパース
  const reports = [];
  for (const rec of oldRecords) {
    for (const f of Object.values(rec)) {
      if (f && typeof f.value === 'string' && /ご報告|売上|売り上げ/.test(f.value)) {
        const p = parseReport(f.value);
        if (p && p.date) reports.push(p);
      }
    }
  }

  // 日付で重複排除（後勝ち）→ 日付昇順
  const byDate = new Map();
  for (const p of reports) byDate.set(p.date, p);
  const parsed = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  console.log(`  → ${parsed.length} 日分の売上データを抽出`);
  if (parsed.length) {
    const s = parsed[0];
    console.log(
      `  例) ${s.date}: 楽天¥${s.sales.rakuten} / Amazon¥${s.sales.amazon} / 自社¥${s.sales.own} / 合計¥${s.sales.total}`
    );
  }

  if (DRY) {
    console.log('\n[DRY_RUN] 投入は行いません。抽出結果を out/preview.json に書き出します。');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync('out', { recursive: true });
    writeFileSync('out/preview.json', JSON.stringify(parsed, null, 2));
    return;
  }

  const records = parsed.map(toRecord);
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    await kintone('POST', '/k/v1/records.json', { app: NEW, records: batch });
    console.log(`  投入 ${Math.min(i + 100, records.length)}/${records.length}`);
  }
  console.log(`\n完了 ✅  ${records.length} 日分を新アプリへ移行しました。`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
