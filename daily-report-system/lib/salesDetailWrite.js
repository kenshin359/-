// ============================================================
//  「売上明細（自動取込）」アプリへの書き込み
// ------------------------------------------------------------
//  CSV取込（scripts/salesImport.js）と
//  Shopify連携（scripts/shopifyImport.js）の両方から使います。
//
//  ★書き込みの決まりごと
//    ・1レコード = 1日
//    ・同じ日を2回入れても二重にならない（同じ販売先の明細だけ入れ替え）
//    ・ほかの販売先の明細は必ず残す
//      （Amazonを入れ直しても、その日の楽天ぶんが消えないように）
//
//  ★売上・転換率報告アプリ（人が手で入力）には一切書き込みません。
// ============================================================
import { optional } from './env.js';
import { call } from './intake.js';
import { dedupKey } from '../kintone/salesDetailSchema.js';

/** 売上明細アプリのアプリID。dry-run のときは未設定でも通す */
export function salesAppId({ allowMissing = false } = {}) {
  const id = optional('KINTONE_SALES_DETAIL_APP_ID');
  if (!id && !allowMissing) {
    throw new Error(
      'KINTONE_SALES_DETAIL_APP_ID が未設定です。\n' +
        '  `npm run create-business-apps salesdetail` で作成し、表示された行を .env に貼ってください。'
    );
  }
  return id;
}

/** 明細1行を kintone の形にする */
function toDetailRow(r) {
  const num = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '');
  return {
    value: {
      s_channel: { value: r.channel },
      s_product: { value: r.product },
      s_sku: { value: String(r.sku ?? '').slice(0, 64) },
      s_asin: { value: String(r.asin ?? '').slice(0, 64) },
      s_title: { value: String(r.title ?? '').slice(0, 64) },
      s_qty: { value: num(r.qty) },
      s_amount: { value: num(r.amount) },
      s_orders: { value: num(r.orders) },
      s_confidence: { value: r.confidence },
    },
  };
}

/**
 * その日ぶんを書く。同じ販売先の明細だけ入れ替える（他の販売先は残す）。
 * @returns {Promise<string>} 画面に出す結果の言葉
 */
export async function upsertDay(app, dateISO, channel, rows, logText, opts = {}) {
  const isDry = opts.dry === true;

  // アプリIDが無いときは kintone を触らない（--dry-run で内容だけ見たい場合）
  if (!app) return '未書き込み（KINTONE_SALES_DETAIL_APP_ID 未設定）';

  const q = encodeURIComponent(`dedup_key = "${dedupKey(dateISO)}" limit 1`);
  const found = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
  const existing = found.records?.[0] ?? null;

  const kept = (existing?.detail?.value ?? []).filter(
    (row) => row.value?.s_channel?.value !== channel
  );
  const record = {
    report_date: { value: dateISO },
    dedup_key: { value: dedupKey(dateISO) },
    source: { value: opts.source ?? 'CSV取込' },
    detail: { value: [...kept, ...rows.map(toDetailRow)] },
    import_log: { value: String(logText).slice(0, 60000) },
  };

  if (isDry) return `${existing ? '更新(予定)' : '新規(予定)'}（他の販売先 ${kept.length}行は保持）`;
  if (existing) {
    await call('PUT', '/k/v1/record.json', { app, id: existing.$id.value, record });
    return '更新';
  }
  await call('POST', '/k/v1/record.json', { app, record });
  return '新規';
}
