// 在庫（data/inventory.csv）＋ 入荷予定（data/incoming.json）から
// 「在庫・入荷ニュース」HTMLを自動生成する。日報システムと同じ流れ。
//   実行: npm run stock-news
//     → out/在庫状況_ニュース.html を生成（そのまま貼付可）
//   環境変数で「デイリーニュース」アプリへ自動投稿も可能：
//     KINTONE_NEWS_APP_ID … 投稿先アプリID
//     NEWS_BODY_FIELD（既定 本文）/ NEWS_TITLE_FIELD（既定 タイトル）/ NEWS_DATE_FIELD（任意）
//     POST=1 を付けると実投稿（未指定はHTML生成のみ）
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const o = {};
    headers.forEach((h, i) => (o[h] = (cells[i] ?? '').trim()));
    return o;
  });
}
const n = (x) => (x === '' || x == null ? 0 : Number(x));
const jdate = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '未定');
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function loadInventory() {
  const f = join(ROOT, 'data/inventory.csv');
  if (!existsSync(f)) throw new Error('data/inventory.csv がありません');
  return parseCsv(readFileSync(f, 'utf8'));
}
function loadIncoming() {
  const f = join(ROOT, 'data/incoming.json');
  if (!existsSync(f)) return { as_of: '', shipments: [] };
  return JSON.parse(readFileSync(f, 'utf8'));
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function build() {
  const inv = loadInventory();
  const { as_of, shipments } = loadIncoming();
  const today = as_of || '2026-08-19';

  // 在庫集計
  const total = inv.reduce((s, r) => s + n(r['Amazon分']) + n(r['良品在庫']), 0);
  const bySize = {};
  for (const r of inv) {
    const sz = r['サイズ'] || '-';
    bySize[sz] = (bySize[sz] || 0) + n(r['Amazon分']) + n(r['良品在庫']);
  }
  const low = inv
    .filter((r) => ['欠品', '僅少'].includes(r['在庫ステータス']))
    .sort((a, b) => n(a['Amazon分']) + n(a['良品在庫']) - (n(b['Amazon分']) + n(b['良品在庫'])));

  // 入荷集計
  const upcoming = shipments.filter((s) => s.status !== '完了');
  const thisWeek = upcoming.filter((s) => s.eta && daysBetween(today, s.eta) >= 0 && daysBetween(today, s.eta) <= 7);
  const thisWeekQty = thisWeek.reduce((s, x) => s + x.qty, 0);
  const nextEtas = [...new Set(upcoming.filter((s) => s.eta).map((s) => jdate(s.eta)))].slice(0, 3);

  const ymd = `${Number(today.slice(5, 7))}月${Number(today.slice(8, 10))}日`;
  const tile = (label, val) =>
    `<td style="background:#f1f3f8;border-radius:10px;padding:12px 14px;width:25%;"><div style="font-size:12px;color:#8a93a6;">${label}</div><div style="font-size:22px;font-weight:bold;">${val}</div></td>`;

  const incomingRows = upcoming
    .map(
      (s, i) =>
        `<tr${i % 2 ? ' style="background:#f5f8fc;"' : ''}><td style="border:1px solid #d0d7e5;padding:5px;">${
          s.eta ? jdate(s.eta) : s.status
        }</td><td style="border:1px solid #d0d7e5;padding:5px;">${esc(s.container)}</td><td style="border:1px solid #d0d7e5;padding:5px;">${esc(
          s.line
        )} ${esc(s.size)}</td><td style="border:1px solid #d0d7e5;padding:5px;text-align:right;">${s.qty.toLocaleString()}</td><td style="border:1px solid #d0d7e5;padding:5px;">${esc(
          s.status
        )}</td></tr>`
    )
    .join('');

  const lowText = low
    .map((r) => `${esc(r['色'])}(${esc(r['サイズ'])}) ${n(r['Amazon分']) + n(r['良品在庫'])}個`)
    .join('／');
  const sizeText = ['S', 'M', 'L']
    .filter((s) => bySize[s])
    .map((s) => `${s} <b>${bySize[s].toLocaleString()}個</b>`)
    .join('　／　');

  const html = `<div style="font-family:'Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',sans-serif;color:#2b3244;line-height:1.65;max-width:780px;">
  <div style="font-size:13px;color:#8a93a6;margin-bottom:4px;">${ymd}　<span style="background:#e7f1ff;color:#1c6fd6;padding:2px 8px;border-radius:10px;font-weight:bold;">📦 在庫・入荷</span></div>
  <div style="font-size:21px;font-weight:bold;margin:2px 0 14px;">倉庫在庫 ${total.toLocaleString()}個・今週入荷 ${thisWeekQty.toLocaleString()}個</div>
  <table style="border-collapse:separate;border-spacing:8px;width:100%;margin:-8px 0 6px;"><tr>
    ${tile('倉庫在庫（多機能PC・8/2）', `${total.toLocaleString()}<span style="font-size:13px;color:#8a93a6;">個</span>`)}
    ${tile('今週入荷予定', `${thisWeekQty.toLocaleString()}<span style="font-size:13px;color:#8a93a6;">個</span>`)}
    ${tile('次回入庫日', nextEtas.join('・') || '—')}
    ${tile('僅少・要補充SKU', `${low.length}<span style="font-size:13px;color:#8a93a6;">色</span>`)}
  </tr></table>
  <div style="border-left:4px solid #2e9e5b;background:#eef8f1;border-radius:8px;padding:10px 14px;margin:12px 0;">
    <div style="font-weight:bold;color:#1b6b3a;">🚚 今週の入荷（倉庫入れ）</div>
    <div style="font-size:13.5px;margin-top:3px;">${
      thisWeek.length
        ? thisWeek.map((s) => `${jdate(s.eta)}：${esc(s.line)} ${esc(s.size)} ${s.qty.toLocaleString()}個（${esc(s.container)}）`).join('<br>')
        : '今週の入庫予定はありません'
    }</div>
  </div>
  <div style="border-left:4px solid #d1495b;background:#fdeef0;border-radius:8px;padding:10px 14px;margin:12px 0;">
    <div style="font-weight:bold;color:#a3273a;">⚠ 欠品・僅少（要補充）</div>
    <div style="font-size:13.5px;margin-top:3px;">${lowText || '該当なし'}</div>
  </div>
  <div style="font-size:14px;font-weight:bold;margin:8px 0 4px;">📦 在庫サマリー（物流倉庫・多機能PC・2026/8/2時点）</div>
  <div style="font-size:13.5px;margin:4px 0 12px;">${sizeText}　＝ 合計 <b>${total.toLocaleString()}個</b></div>
  <div style="font-size:14px;font-weight:bold;margin:8px 0 4px;">🚢 入荷予定（コンテナ別）</div>
  <table style="border-collapse:collapse;width:100%;font-size:12.5px;">
    <tr style="background:#305496;color:#fff;"><th style="border:1px solid #b7c3d9;padding:5px;">入荷</th><th style="border:1px solid #b7c3d9;padding:5px;">コンテナ</th><th style="border:1px solid #b7c3d9;padding:5px;">商品/サイズ</th><th style="border:1px solid #b7c3d9;padding:5px;">数量</th><th style="border:1px solid #b7c3d9;padding:5px;">状態</th></tr>
    ${incomingRows}
  </table>
  <p style="font-size:11px;color:#8a93a6;margin-top:10px;">※ 在庫は物流倉庫の2026/8/2スナップショット（多機能PCのみ）。入荷予定は物流スケジュール（監査役チェック済）より自動生成。</p>
</div>`;

  return { html, title: `在庫・入荷ニュース（${ymd}）｜倉庫${total.toLocaleString()}個・今週入荷${thisWeekQty.toLocaleString()}個`, date: today };
}

async function main() {
  const { html, title, date } = build();
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  writeFileSync(join(ROOT, 'out', '在庫状況_ニュース.html'), html);
  console.log('生成 ✅  out/在庫状況_ニュース.html');
  console.log('  タイトル:', title);

  if (process.env.POST === '1' && process.env.KINTONE_NEWS_APP_ID) {
    const { kintone } = await import('./client.js');
    const bodyField = process.env.NEWS_BODY_FIELD || '本文';
    const titleField = process.env.NEWS_TITLE_FIELD || 'タイトル';
    const dateField = process.env.NEWS_DATE_FIELD || '';
    const record = { [bodyField]: { value: html }, [titleField]: { value: title } };
    if (dateField) record[dateField] = { value: date };
    const r = await kintone('POST', '/k/v1/record.json', { app: process.env.KINTONE_NEWS_APP_ID, record });
    console.log('  → デイリーニュースへ投稿しました（id=' + r.id + '）');
  } else {
    console.log('  （POST=1 と KINTONE_NEWS_APP_ID を設定するとデイリーニュースへ自動投稿します）');
  }
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
