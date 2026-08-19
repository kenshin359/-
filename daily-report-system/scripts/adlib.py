#!/usr/bin/env python3
# ============================================================
#  広告CSVの共通パーサ（adCostReport.py / newsDaily.py 共用）
# ------------------------------------------------------------
#  ・ファイル名はNFKC正規化して判定（Mac由来のNFD濁点対策）
#  ・「8/1〜8/5」のような期間まとめ行は日別集計から除外
# ============================================================
import csv, io, re, unicodedata


def z2h(s):
    return unicodedata.normalize('NFKC', s)


def yen_num(s):
    s = str(s).replace('￥', '').replace('¥', '').replace(',', '').replace('"', '').strip()
    if s in ('', '-', '—'):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def day_from_name(name, month_num):
    m = re.search(rf'{month_num}[.:：月\s]?\s*([0-3]?\d)', z2h(name))
    return int(m.group(1)) if m else None


def read_text(raw):
    for enc in ('utf-8-sig', 'cp932', 'utf-16'):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode('utf-8', 'replace')


def parse_date(s):
    m = re.search(r'(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})', z2h(str(s)))
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def detect_media(name):
    """ファイル名から (media, 金額列名) を返す。該当なしは (None, None)。"""
    nk = z2h(name)
    low = nk.lower()
    if 'トラベル' in nk:
        return 'trav', '消化金額'
    if 'カタログ' in nk:
        return 'cat', '消化金額'
    if 'rpp' in low or 'r pp' in low:
        return 'rpp', '実績額(合計)'
    if ('amazon' in low or 'アマゾン' in nk) and '広告' in nk:
        return 'az', '合計費用 (換算済み)'
    return None, None


def _find_col(hdr, kw, exact=False):
    for j, c in enumerate(hdr):
        if (c.strip() == kw) if exact else (kw in c):
            return j
    return None


def rows_after_header(text, colname):
    """colname を含むヘッダー行を探し、(ヘッダー, データ行リスト) を返す。無ければ (None, [])。"""
    rows = list(csv.reader(io.StringIO(text)))
    hdr = next((r for r in rows if any(colname in c for c in r)), None)
    if not hdr:
        return None, []
    return hdr, rows[rows.index(hdr) + 1:]


def sum_col(text, colname):
    hdr, body = rows_after_header(text, colname)
    if not hdr:
        return None
    i = _find_col(hdr, colname)
    # 行の有効判定は合計列のセルで行う（RPP商品別CSVは先頭列が常に空のため）
    return int(sum(yen_num(r[i]) for r in body if len(r) > i and str(r[i]).strip()))


def daily_col(text, colname):
    """日付列（レポート開始日/日付）がある表を日ごとに合計して {(年,月,日): 金額} を返す。
    期間まとめ行（開始日≠終了日）は除外。日付列が無ければ None。"""
    hdr, body = rows_after_header(text, colname)
    if not hdr:
        return None
    i = _find_col(hdr, colname)
    di = _find_col(hdr, 'レポート開始日')
    if di is None:
        di = _find_col(hdr, '日付', exact=True)
    if di is None:
        return None
    out = {}
    for r in body:
        if len(r) <= max(i, di) or not str(r[i]).strip():
            continue
        ds = re.findall(r'(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})', z2h(str(r[di])))
        if len(ds) >= 2 and ds[0] != ds[1]:
            continue
        d = parse_date(r[di])
        if d:
            out[d] = out.get(d, 0) + yen_num(r[i])
    return {k: int(v) for k, v in out.items()} or None


def rpp_day_metrics(text, target_ymd):
    """RPP CSVから対象日の クリック/費用/売上(720h)/件数 を取り出す。"""
    hdr, body = rows_after_header(text, '実績額(合計)')
    if not hdr:
        return None
    ic = _find_col(hdr, 'クリック数(合計)')
    i_cost = _find_col(hdr, '実績額(合計)')
    i_s = _find_col(hdr, '売上金額(合計720')
    i_o = _find_col(hdr, '売上件数(合計720')
    di = _find_col(hdr, '日付', exact=True)
    tot = {'clicks': 0, 'cost': 0, 'sales': 0, 'orders': 0}
    hit = False
    for r in body:
        if len(r) <= max(x for x in (ic, i_cost, i_s, i_o) if x is not None):
            continue
        if not str(r[i_cost]).strip():
            continue
        if di is not None:
            ds = re.findall(r'(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})', z2h(str(r[di])))
            if len(ds) >= 2 and ds[0] != ds[1]:
                continue
            d = parse_date(r[di])
            if d and (d[0], d[1], d[2]) != target_ymd:
                continue
        hit = True
        if ic is not None:
            tot['clicks'] += yen_num(r[ic])
        tot['cost'] += yen_num(r[i_cost])
        if i_s is not None:
            tot['sales'] += yen_num(r[i_s])
        if i_o is not None:
            tot['orders'] += yen_num(r[i_o])
    return {k: int(v) for k, v in tot.items()} if hit else None


def amazon_by_type(text):
    """Amazon広告CSVをタイプ(SP/SB/SB2/SD)別に集計。"""
    hdr, body = rows_after_header(text, '合計費用 (換算済み)')
    if not hdr:
        return None
    i_t = _find_col(hdr, 'タイプ', exact=True)
    i_c = _find_col(hdr, 'クリック数', exact=True)
    i_cost = _find_col(hdr, '合計費用 (換算済み)', exact=True)
    i_p = _find_col(hdr, '商品購入数', exact=True)
    i_s = _find_col(hdr, '売上 (換算済み)', exact=True)
    if None in (i_t, i_cost):
        return None
    out = {}
    for r in body:
        if len(r) <= max(x for x in (i_t, i_c, i_cost, i_p, i_s) if x is not None):
            continue
        if not r[0].strip():
            continue
        t = r[i_t].strip() or '?'
        e = out.setdefault(t, {'clicks': 0, 'cost': 0, 'purch': 0, 'sales': 0})
        if i_c is not None:
            e['clicks'] += yen_num(r[i_c])
        e['cost'] += yen_num(r[i_cost])
        if i_p is not None:
            e['purch'] += yen_num(r[i_p])
        if i_s is not None:
            e['sales'] += yen_num(r[i_s])
    return {t: {k: int(v) for k, v in e.items()} for t, e in out.items()} or None


def google_campaign_daily(text):
    """Googleキャンペーン形式CSVを日別に {(y,m,d): {imps,clicks,cost,conv,convv}}。
    合計行・アセット別レポートは除外。"""
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return None
    hdr = rows[0]
    if not any('キャンペーン' in c for c in hdr):
        return None
    gi = lambda kw: _find_col(hdr, kw)
    i_d = gi('日付')
    i_c = gi('クリック数')
    i_cost = gi('費用(円)') if gi('費用(円)') is not None else gi('費用')
    i_cv = gi('コンバージョン')
    i_cvv = gi('コンバージョン値')
    i_im = gi('表示回数')
    if None in (i_d, i_c, i_cost):
        return None
    out = {}
    for r in rows[1:]:
        if len(r) <= max(x for x in (i_d, i_c, i_cost) if x is not None):
            continue
        # 合計行・アカウント合計行はキャンペーン名や区分に「合計」を含む
        if any('合計' in str(c) for c in r[:4]):
            continue
        d = parse_date(r[i_d])
        if not d:
            continue
        e = out.setdefault(d, {'imps': 0, 'clicks': 0, 'cost': 0, 'conv': 0.0, 'convv': 0})
        if i_im is not None and len(r) > i_im:
            e['imps'] += yen_num(r[i_im])
        e['clicks'] += yen_num(r[i_c])
        e['cost'] += yen_num(r[i_cost])
        if i_cv is not None and len(r) > i_cv:
            e['conv'] += yen_num(r[i_cv])
        if i_cvv is not None and len(r) > i_cvv:
            e['convv'] += yen_num(r[i_cvv])
    return out or None
