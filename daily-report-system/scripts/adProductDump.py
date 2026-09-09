#!/usr/bin/env python3
# ============================================================
#  広告費の商品別ダンプ（媒体×商品カテゴリの月間広告費）
# ------------------------------------------------------------
#  adCostReport.py と同じ手順でKPIアプリ(30)の添付CSVを読み、
#  行の名前列（RPP=商品管理番号／Amazon=キャンペーン名／
#  Meta=広告セット名）を config/ad-campaign-rules.json の
#  キーワードで商品カテゴリに分類して月間合計をログに出します。
#  ★キントーンは読むだけ。数字は 0-9→A-J 置換（可逆）。
#  ★キャンペーン名・広告セット名そのものは出力しません
#    （公開リポジトリのため。出すのは分類後のカテゴリ名だけ）。
#  実行: python3 scripts/adProductDump.py --month=2026-08
# ============================================================
import base64, csv, io, json, os, re, sys, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JST = timezone(timedelta(hours=9))

BASE = os.environ['KINTONE_BASE_URL'].rstrip('/')
AUTH = base64.b64encode(f"{os.environ['KINTONE_USER']}:{os.environ['KINTONE_PASSWORD']}".encode()).decode()
KPI_APP = os.environ.get('KINTONE_KPI_APP_ID') or '30'


def kget(path):
    req = urllib.request.Request(BASE + path, headers={'X-Cybozu-Authorization': AUTH})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def z2h(s):
    return unicodedata.normalize('NFKC', str(s))


def yen_num(s):
    s = str(s).replace('￥', '').replace('¥', '').replace(',', '').replace('"', '').strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def read_text(raw):
    for enc in ('utf-8-sig', 'cp932', 'utf-16'):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode('utf-8', 'replace')


# ---- 商品分類（adClassify.js の classifyProduct と同じルール） ----
RULES = json.load(open(os.path.join(ROOT, 'config', 'ad-campaign-rules.json'), encoding='utf-8'))


def classify_product(name):
    upper = z2h(name).upper()
    for p in RULES.get('products', []):
        for kw in p.get('keywords', []):
            k = z2h(kw).upper()
            if k and k in upper:
                return p['canonical']
    return RULES.get('unknown_product', '未分類')


# ---- RPPの商品管理番号 → 商品カテゴリ（楽天の商品ページコード） ----
RPP_MAP = [
    ('LIBETEE001', '多機能PC'),      # libetee より先に判定する
    ('SKARUMIN', 'ノーマルアルミ'),
    ('LIBETEE', '多機能アルミ'),
    ('SUITCASE', '多機能PC'),
    ('ZIPSUITCASE', '多機能PC'),
    ('OUTDOORSK', 'アウトドア'),
]


def classify_rpp(code):
    upper = z2h(code).upper()
    for kw, label in RPP_MAP:
        if kw in upper:
            return label
    return 'その他・スーツケース以外'


def find_col(hdr, kw):
    return next((j for j, c in enumerate(hdr) if kw in c), None)


def main():
    marg = next((a for a in sys.argv if a.startswith('--month=')), None)
    now = datetime.now(JST)
    month = marg.split('=', 1)[1] if marg else now.strftime('%Y-%m')
    m_num = int(month.split('-')[1])

    records = []
    offset = 0
    while True:
        q = urllib.parse.quote(
            f'report_date >= "{month}-01" order by report_date desc limit 100 offset {offset}')
        chunk = json.loads(kget(f'/k/v1/records.json?app={KPI_APP}&query={q}')).get('records', [])
        records.extend(chunk)
        if len(chunk) < 100 or offset >= 900:
            break
        offset += 100

    def day_from_name(name):
        m = re.search(rf'{m_num}[.:：月\s]?\s*([0-3]?\d)', z2h(name))
        return int(m.group(1)) if m else None

    # (media, day) -> {カテゴリ: 金額}。新しいレコード優先・最初の値を採用（重複添付対策）
    vals = {}
    skipped = []
    for rec in records:
        for field in ('file_ads', 'file_sales', 'file_other'):
            for f in rec.get(field, {}).get('value', []):
                name = f.get('name', '')
                nk = z2h(name)
                low = nk.lower()
                if not name.endswith('.csv'):
                    continue
                media = colname = namecol = None
                if 'トラベル' in nk:
                    media, colname, namecol = 'trav', '消化金額', '広告セット名'
                elif 'カタログ' in nk:
                    media, colname, namecol = 'cat', '消化金額', '広告セット名'
                elif 'rpp' in low or 'r pp' in low:
                    media, colname, namecol = 'rpp', '実績額(合計)', '商品管理番号'
                elif ('amazon' in low or 'アマゾン' in nk) and '広告' in nk:
                    media, colname, namecol = 'az', '合計費用 (換算済み)', 'キャンペーン名'
                if not media:
                    continue
                try:
                    text = read_text(kget(f"/k/v1/file.json?fileKey={f['fileKey']}"))
                    rows = list(csv.reader(io.StringIO(text)))
                    hdr = next((r for r in rows if any(colname in c for c in r)), None)
                    if not hdr:
                        continue
                    ai = find_col(hdr, colname)
                    ni = find_col(hdr, namecol)
                    if ni is None and media in ('trav', 'cat'):
                        ni = find_col(hdr, 'キャンペーン名')
                    di = find_col(hdr, 'レポート開始日')
                    if di is None:
                        di = next((j for j, c in enumerate(hdr) if c.strip() == '日付'), None)
                    if ni is None:
                        skipped.append(f'{media}: 名前列なし（商品別分類不可）')
                        continue
                    body = rows[rows.index(hdr) + 1:]
                    if di is not None:
                        per_day = {}
                        for r in body:
                            if len(r) <= max(ai, ni, di) or not str(r[ai]).strip():
                                continue
                            ds = re.findall(r'(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})', z2h(r[di]))
                            if not ds or (len(ds) >= 2 and ds[0] != ds[1]):
                                continue
                            yy, mm, dd = map(int, ds[0])
                            if f'{yy:04d}-{mm:02d}' != month:
                                continue
                            label = classify_rpp(r[ni]) if media == 'rpp' else classify_product(r[ni])
                            d = per_day.setdefault(dd, {})
                            d[label] = d.get(label, 0) + yen_num(r[ai])
                        for dd, byp in per_day.items():
                            if (media, dd) not in vals:
                                vals[(media, dd)] = byp
                    else:
                        day = day_from_name(name)
                        if not day or (media, day) in vals:
                            continue
                        byp = {}
                        for r in body:
                            if len(r) <= max(ai, ni) or not str(r[ai]).strip():
                                continue
                            label = classify_rpp(r[ni]) if media == 'rpp' else classify_product(r[ni])
                            byp[label] = byp.get(label, 0) + yen_num(r[ai])
                        if byp:
                            vals[(media, day)] = byp
                except Exception as e:
                    print(f'  ⚠ 読み込み失敗: {e}')

    out = {}
    for (media, _), byp in vals.items():
        m = out.setdefault(media, {})
        for label, amt in byp.items():
            m[label] = m.get(label, 0) + int(amt)
    days = {media: sorted(d for (m2, d) in vals if m2 == media) for media in out}
    enc = re.sub(r'\d', lambda x: 'ABCDEFGHIJ'[int(x.group())],
                 json.dumps({'month': month, 'byProduct': out,
                             'days': {m2: [str(d) for d in ds] for m2, ds in days.items()}},
                            ensure_ascii=False))
    print('===ADPROD_B===')
    print(enc)
    for s in sorted(set(skipped)):
        print('注記:', s)


if __name__ == '__main__':
    main()
