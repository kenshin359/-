// ============================================================
//  売上明細レコードへの「日次CSV」自動添付
// ------------------------------------------------------------
//  1日1レコードに、チャネル別のCSV（例: 2026-08-01_楽天.csv）を添付します。
//  表（サブテーブル）はキントーンのグラフ・集計用、
//  添付CSVはExcelでの深掘り分析用です。
//
//  ★同じ日・同じチャネルのファイルは置き換えます（二重になりません）。
//    他のチャネルのファイルは残します。
// ============================================================
import { optional, required } from './env.js';
import { call } from './intake.js';
import { dedupKey } from '../kintone/salesDetailSchema.js';

/** 添付欄のフィールドコード（syncSalesOptions が自動で作ります） */
export const FILE_FIELD = 'day_files';

/** 明細行 → Excelで開けるCSV（UTF-8 BOM付き） */
export function rowsToCsv(dayRows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['日付', '販売先', '商品', '判定', 'SKU', 'ASIN', '商品名', '数量', '売上'];
  const lines = [head.join(',')];
  for (const r of dayRows) {
    lines.push(
      [r.date, r.channel, r.product, r.confidence, r.sku, r.asin, r.title, r.qty, Math.round(r.amount)]
        .map(esc)
        .join(',')
    );
  }
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

function auth() {
  const token = optional('KINTONE_API_TOKEN_INTAKE');
  if (optional('KINTONE_USER') && optional('KINTONE_PASSWORD')) {
    return {
      'X-Cybozu-Authorization': Buffer.from(
        `${required('KINTONE_USER')}:${required('KINTONE_PASSWORD')}`
      ).toString('base64'),
    };
  }
  if (token) return { 'X-Cybozu-API-Token': token };
  throw new Error('KINTONE_USER / KINTONE_PASSWORD が未設定です');
}

/** ファイルを1つアップロードして fileKey をもらう */
export async function uploadFile(buffer, fileName) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'text/csv' }), fileName);
  const res = await fetch(`${base()}/k/v1/file.json`, {
    method: 'POST',
    headers: auth(),
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.fileKey) {
    throw new Error(`ファイルのアップロードに失敗: HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.fileKey;
}

/**
 * その日のレコードに、チャネル別CSVを添付する。
 * 同名（同日・同チャネル）の古いファイルだけ置き換え、他は残す。
 */
export async function attachDayCsv(app, dateISO, channel, dayRows) {
  const q = encodeURIComponent(`dedup_key = "${dedupKey(dateISO)}" limit 1`);
  const found = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
  const rec = found.records?.[0];
  if (!rec) return '添付先レコードが見つかりませんでした';
  if (!(FILE_FIELD in rec)) {
    return `添付欄（${FILE_FIELD}）がまだありません。先に「キントーンの選択肢を更新」を実行してください`;
  }

  const fileName = `${dateISO}_${channel}.csv`;
  // 既存ファイルのうち、今回置き換える1本以外は fileKey をそのまま渡して残す
  const kept = (rec[FILE_FIELD]?.value ?? [])
    .filter((f) => f.name !== fileName)
    .map((f) => ({ fileKey: f.fileKey }));

  const fileKey = await uploadFile(rowsToCsv(dayRows), fileName);
  await call('PUT', '/k/v1/record.json', {
    app,
    id: rec.$id.value,
    record: { [FILE_FIELD]: { value: [...kept, { fileKey }] } },
  });
  return `添付（${fileName}）`;
}
