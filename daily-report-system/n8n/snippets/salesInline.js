// ============================================================
//  n8n の Code ノードに埋め込む売上集計ロジック（自己完結版）
// ------------------------------------------------------------
//  n8n の Code ノードは外部ファイルを import できないため、
//  lib/ と同じ処理をこのファイル1枚にまとめています。
//
//  ★このファイルを直接編集し、npm run build:n8n で
//    n8n/workflow-6-sales-report.json に埋め込みます。
//    手でJSONを書き換えないでください。
//
//  ★lib/ 側とズレていないことは test/sales-inline.test.js が
//    毎回チェックします（同じサンプルで同じ文面が出ること）。
// ============================================================

export function buildSalesText(files, mapping, dateISO, prevISO, opts = {}) {
  const results = files.map((f) => aggregateFile(f, mapping));
  const summary = buildDailySummary(results, dateISO, prevISO);
  return { text: formatSalesSummary(summary, opts), summary, results };
}

// ── 文字コード ───────────────────────────────────────────
function decodeText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' };
  }
}

function detectDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  return (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
}

function parseCsv(text, delimiter) {
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\r') {
      if (text[i + 1] !== '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function normalizeHeader(h) {
  return String(h ?? '')
    .replace(/^﻿/, '')
    .replace(/[　\s]+/g, '')
    .replace(/^["']|["']$/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

function readTable(buf, opts = {}) {
  const { text, encoding } = decodeText(buf);
  const delimiter = detectDelimiter(text);
  let matrix = parseCsv(text, delimiter);
  const skip = Number(opts.skipRows) || 0;
  if (skip > 0) matrix = matrix.slice(skip);
  if (matrix.length === 0) return { headers: [], rows: [], encoding, delimiter };
  const headers = matrix[0].map(normalizeHeader);
  const rows = matrix.slice(1).map((cells) => {
    const o = {};
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === '') continue;
      o[headers[i]] = (cells[i] ?? '').trim();
    }
    return o;
  });
  return { headers, rows, encoding, delimiter };
}

// ── 値の読み取り ─────────────────────────────────────────
function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (s === '') return null;
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９．，－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (/^(-|‐|—|ー|n\/a|na|null|なし|未計上|不明)$/i.test(s)) return null;
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) { negative = true; s = paren[1]; }
  s = s.replace(/[¥￥$€]/g, '').replace(/jpy|usd|円|件|点|個/gi, '').replace(/[,\s]/g, '');
  if (s.startsWith('-') || s.startsWith('△') || s.startsWith('▲')) {
    negative = true;
    s = s.replace(/^[-△▲]/, '');
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function iso(y, mo, d) {
  const mm = String(Number(mo)).padStart(2, '0');
  const dd = String(Number(d)).padStart(2, '0');
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mm}-${dd}`;
}

function parseDate(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s === '') return null;
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  let m = s.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return iso(m[3], m[1], m[2]);
  return null;
}

function yen(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}¥${Math.round(Math.abs(n)).toLocaleString('ja-JP')}`;
}

function deltaPct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatDelta(pct) {
  if (pct === null) return '';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ── 集計 ─────────────────────────────────────────────────
function detectChannel(fileName, mapping) {
  const name = String(fileName).toLowerCase();
  for (const ch of mapping.channels) {
    const patterns = Array.isArray(ch.match) ? ch.match : [ch.match];
    if (patterns.some((p) => p && name.includes(String(p).toLowerCase()))) return ch;
  }
  return null;
}

function pickColumn(headers, candidates = []) {
  const wanted = candidates.map(normalizeHeader);
  for (const w of wanted) if (headers.includes(w)) return w;
  for (const w of wanted) {
    if (!w) continue;
    const hit = headers.find((h) => h.includes(w) || w.includes(h));
    if (hit) return hit;
  }
  return null;
}

function blankBucket(isAd) {
  return isAd
    ? { cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
    : { revenue: 0, units: 0, orderIds: new Set() };
}

function aggregateFile(file, mapping) {
  const channel = detectChannel(file.name, mapping);
  if (!channel)
    return { ok: false, fileName: file.name, reason: '媒体を判別できませんでした（ファイル名に amazon / rakuten / meta / rpp などを含めてください）' };

  const { headers, rows, encoding } = readTable(file.buffer, { skipRows: channel.skipRows });
  if (rows.length === 0) return { ok: false, fileName: file.name, channel, reason: 'データ行がありません' };

  const cols = channel.columns || {};
  const dateCol = pickColumn(headers, cols.date);
  if (!dateCol)
    return { ok: false, fileName: file.name, channel, reason: `日付の列が見つかりません（見出し: ${headers.slice(0, 12).join(' / ')}）` };

  const isAd = channel.kind === 'ad';
  const valueCols = isAd
    ? {
        cost: pickColumn(headers, cols.cost),
        impressions: pickColumn(headers, cols.impressions),
        clicks: pickColumn(headers, cols.clicks),
        conversions: pickColumn(headers, cols.conversions),
        conversionValue: pickColumn(headers, cols.conversionValue),
      }
    : {
        amount: pickColumn(headers, cols.amount),
        quantity: pickColumn(headers, cols.quantity),
        orderId: pickColumn(headers, cols.orderId),
        product: pickColumn(headers, cols.product),
      };

  const mainCol = isAd ? valueCols.cost : valueCols.amount;
  if (!mainCol)
    return { ok: false, fileName: file.name, channel, reason: `${isAd ? '広告費' : '売上金額'}の列が見つかりません（見出し: ${headers.slice(0, 12).join(' / ')}）` };

  const byDate = new Map();
  const byProduct = new Map();
  let skipped = 0;

  for (const row of rows) {
    const date = parseDate(row[dateCol]);
    if (!date) { skipped++; continue; }
    const bucket = byDate.get(date) || blankBucket(isAd);
    byDate.set(date, bucket);

    if (isAd) {
      bucket.cost += parseAmount(row[valueCols.cost]) ?? 0;
      if (valueCols.impressions) bucket.impressions += parseAmount(row[valueCols.impressions]) ?? 0;
      if (valueCols.clicks) bucket.clicks += parseAmount(row[valueCols.clicks]) ?? 0;
      if (valueCols.conversions) bucket.conversions += parseAmount(row[valueCols.conversions]) ?? 0;
      if (valueCols.conversionValue) bucket.conversionValue += parseAmount(row[valueCols.conversionValue]) ?? 0;
    } else {
      const amount = parseAmount(row[valueCols.amount]) ?? 0;
      bucket.revenue += amount;
      bucket.units += valueCols.quantity ? (parseAmount(row[valueCols.quantity]) ?? 0) : 0;
      if (valueCols.orderId) bucket.orderIds.add(row[valueCols.orderId]);
      else bucket.orderIds.add(`row-${bucket.orderIds.size}`);
      if (valueCols.product) {
        const name = (row[valueCols.product] || '').trim();
        if (name) {
          const key = `${date} ${name}`;
          const p = byProduct.get(key) || { name, revenue: 0, units: 0, date };
          p.revenue += amount;
          p.units += valueCols.quantity ? (parseAmount(row[valueCols.quantity]) ?? 0) : 0;
          byProduct.set(key, p);
        }
      }
    }
  }

  const daily = {};
  for (const [date, b] of byDate) {
    daily[date] = isAd
      ? { cost: b.cost, impressions: b.impressions, clicks: b.clicks, conversions: b.conversions, conversionValue: b.conversionValue }
      : { revenue: b.revenue, units: b.units, orders: b.orderIds.size };
  }

  return {
    ok: true,
    fileName: file.name,
    channelId: channel.id,
    label: channel.label,
    kind: channel.kind,
    encoding,
    rowCount: rows.length,
    skipped,
    usedColumns: { date: dateCol, ...valueCols },
    daily,
    products: [...byProduct.values()],
  };
}

function buildDailySummary(results, dateISO, prevISO) {
  const ok = results.filter((r) => r.ok);
  const salesChannels = [];
  const adChannels = [];

  for (const r of ok) {
    const today = r.daily[dateISO];
    const prev = r.daily[prevISO];
    if (r.kind === 'ad') {
      adChannels.push({
        id: r.channelId, label: r.label,
        cost: today?.cost ?? 0, prevCost: prev?.cost ?? null,
        clicks: today?.clicks ?? 0, conversions: today?.conversions ?? 0,
        conversionValue: today?.conversionValue ?? 0, hasData: !!today,
      });
    } else {
      salesChannels.push({
        id: r.channelId, label: r.label,
        revenue: today?.revenue ?? 0, prevRevenue: prev?.revenue ?? null,
        orders: today?.orders ?? 0, units: today?.units ?? 0, hasData: !!today,
      });
    }
  }

  const totalRevenue = salesChannels.reduce((s, c) => s + c.revenue, 0);
  const prevRevenue = salesChannels.reduce((s, c) => s + (c.prevRevenue ?? 0), 0);
  const totalOrders = salesChannels.reduce((s, c) => s + c.orders, 0);
  const totalCost = adChannels.reduce((s, c) => s + c.cost, 0);
  const prevCost = adChannels.reduce((s, c) => s + (c.prevCost ?? 0), 0);

  const productMap = new Map();
  for (const r of ok) {
    if (r.kind === 'ad') continue;
    for (const p of r.products) {
      if (p.date !== dateISO) continue;
      const cur = productMap.get(p.name) || { name: p.name, revenue: 0, units: 0 };
      cur.revenue += p.revenue;
      cur.units += p.units;
      productMap.set(p.name, cur);
    }
  }
  const topProducts = [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  return {
    date: dateISO,
    prevDate: prevISO,
    salesChannels,
    adChannels,
    totals: {
      revenue: totalRevenue,
      prevRevenue: salesChannels.some((c) => c.prevRevenue !== null) ? prevRevenue : null,
      orders: totalOrders,
      aov: totalOrders > 0 ? totalRevenue / totalOrders : null,
      adCost: totalCost,
      prevAdCost: adChannels.some((c) => c.prevCost !== null) ? prevCost : null,
      roas: totalCost > 0 ? totalRevenue / totalCost : null,
      adRatio: totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : null,
    },
    topProducts,
    problems: results.filter((r) => !r.ok),
  };
}

// ── 文面 ─────────────────────────────────────────────────
function trend(pct) {
  if (pct === null) return '';
  if (pct <= -10) return ' ⚠️';
  if (pct >= 10) return ' 🔺';
  return '';
}

function line(label, value, pct) {
  const d = pct === null || pct === undefined ? '' : `（前日比 ${formatDelta(pct)}）${trend(pct)}`;
  return `${label}　${value}${d}`;
}

function formatSalesSummary(summary, opts = {}) {
  const t = summary.totals;
  const out = [];
  out.push(`${opts.title || '💰 売上速報'}（${summary.date}）`);
  out.push('');

  const revPct = t.prevRevenue === null ? null : deltaPct(t.revenue, t.prevRevenue);
  out.push(line('総売上', yen(t.revenue), revPct));
  out.push(`注文数　${t.orders.toLocaleString('ja-JP')}件` + (t.aov ? `　客単価 ${yen(t.aov)}` : ''));
  out.push('');

  if (summary.salesChannels.length) {
    out.push('【媒体別】');
    for (const c of [...summary.salesChannels].sort((a, b) => b.revenue - a.revenue)) {
      if (!c.hasData) { out.push(`${c.label}　データなし`); continue; }
      out.push(line(c.label, yen(c.revenue), c.prevRevenue === null ? null : deltaPct(c.revenue, c.prevRevenue)));
    }
    out.push('');
  }

  if (summary.adChannels.length) {
    out.push('【広告】');
    for (const c of summary.adChannels) {
      if (!c.hasData) { out.push(`${c.label}　データなし`); continue; }
      out.push(line(c.label, yen(c.cost), c.prevCost === null ? null : deltaPct(c.cost, c.prevCost)));
    }
    out.push(`広告費計　${yen(t.adCost)}`);
    if (t.roas !== null)
      out.push(`ROAS　${t.roas.toFixed(2)}${t.roas < 2 ? ' ⚠️' : ''}　（広告費率 ${t.adRatio.toFixed(1)}%）`);
    out.push('');
  }

  if (summary.topProducts.length) {
    out.push('【売れ筋 TOP3】');
    for (const p of summary.topProducts.slice(0, 3))
      out.push(`・${p.name}　${yen(p.revenue)}${p.units ? `　${p.units}点` : ''}`);
    out.push('');
  }

  if (opts.comment && opts.comment !== '特記事項なし') {
    out.push(`💡 ${opts.comment}`);
    out.push('');
  }

  if (summary.problems?.length) {
    out.push('【要確認】');
    for (const p of summary.problems) out.push(`・${p.fileName}: ${p.reason}`);
  }

  return out.join('\n').trim();
}
