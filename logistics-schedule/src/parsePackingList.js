// パッキングリスト（.xlsx / .xls）を 1 ファイル読み、物流スケジュール 1 レコード分の
// 構造化データに変換する。ベンダー各社で微妙に違っても崩れないよう、
// 「ヘッダー行（货柜号…）を探す → 位置で列を拾う」方式で解析する。
//
// 想定レイアウト（今回の各社共通）:
//   行:  パッキングリスト
//   行:  PO号： LM260507            日期：      2026-07-24
//   行:  货柜号 封条号 品名 颜色 规格 外箱尺寸 毛重 净重 数量 体积 总体积   ← ヘッダー
//   行:  <コンテナ番号> <シール> <品名> ...                               ← 明細（1行目）
//   行:                <品名> ...                                          ← 明細（結合セル）
//   行:  柜型: 40GP            合计   5383.5  ...  745       68.94          ← 合計
//   行:  拉杆箱材质 ...
import XLSX from 'xlsx';

// Excel シリアル値 → 'YYYY-MM-DD'（1900 日付システム、タイムゾーン非依存）
function serialToYMD(serial) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// セル値を日付文字列へ。数値ならシリアル、文字列なら緩くパース。
function toYMD(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return serialToYMD(v);
  if (v instanceof Date) return serialToYMD((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
  const m = String(v).match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

const num = (v, dp = 3) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f; // 浮動小数の誤差（…9999）を丸める
};
const str = (v) => (v == null ? '' : String(v).trim());

export function parsePackingList(filePath) {
  const wb = XLSX.readFile(filePath, { raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  // ヘッダー行（货柜号 を含む行）を探す
  const headIdx = rows.findIndex((r) => r.some((c) => str(c).includes('货柜号')));
  if (headIdx < 0) throw new Error('ヘッダー行（货柜号）が見つかりません');

  // 上部メタ情報（PO号・日期）
  let po = '';
  let shippingDate = '';
  for (let i = 0; i < headIdx; i++) {
    for (let c = 0; c < rows[i].length; c++) {
      const cell = str(rows[i][c]);
      const mp = cell.match(/PO号[：:]\s*([A-Za-z0-9-]+)/);
      if (mp) po = mp[1];
      if (cell.includes('日期')) {
        // 同じセル内 or 右隣以降にある日付を採用
        const inline = cell.replace(/.*日期[：:]/, '');
        shippingDate = toYMD(inline) || shippingDate;
        for (let k = c + 1; k < rows[i].length && !shippingDate; k++) {
          shippingDate = toYMD(rows[i][k]);
        }
      }
    }
  }

  // 列インデックス: 0货柜号 1封条号 2品名 3颜色 4规格 5外箱尺寸 6毛重 7净重 8数量 9体积 10总体积
  let containerNo = '';
  let sealNo = '';
  let containerType = '';
  const items = [];
  const totals = { gw: null, nw: null, qty: null, volume: null };

  for (let i = headIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const c0 = str(r[0]);

    // 柜型 / 合计 行（明細の終端）
    const typeCell = r.map(str).find((c) => c.includes('柜型'));
    const isTotal = r.some((c) => str(c).includes('合计'));
    if (typeCell) {
      const mt = typeCell.match(/柜型[:：]\s*([A-Za-z0-9']+)/);
      if (mt) containerType = mt[1].replace(/'/g, '');
    }
    if (isTotal) {
      totals.gw = num(r[6]);
      totals.nw = num(r[7]);
      totals.qty = num(r[8]);
      totals.volume = num(r[10]);
      break; // 合計行以降（材质メモ等）は読まない
    }

    // 明細行の 1 行目にコンテナ番号・シール番号
    if (!containerNo && c0) containerNo = c0;
    if (!sealNo && str(r[1])) sealNo = str(r[1]);

    const name = str(r[2]);
    if (!name) continue; // 品名の無い行はスキップ
    items.push({
      item_name: name,
      item_color: str(r[3]),
      item_spec: str(r[4]),
      carton_size: str(r[5]),
      item_gw: num(r[6]),
      item_nw: num(r[7]),
      item_qty: num(r[8]),
      item_volume: num(r[10]),
    });
  }

  // 合計が取れない場合は明細から数量を合算
  const qtySum = items.reduce((s, it) => s + (it.item_qty || 0), 0);

  return {
    po_number: po,
    shipping_date: shippingDate,
    container_no: containerNo,
    seal_no: sealNo,
    container_type: containerType,
    gross_weight: totals.gw,
    net_weight: totals.nw,
    total_qty: totals.qty != null ? totals.qty : qtySum || null,
    total_volume: totals.volume,
    items,
  };
}
