#!/usr/bin/env python3
# ============================================================
#  リベティ・デイリーニュース 自動投稿（毎朝11:10）
# ------------------------------------------------------------
#  昨日の 売上・販売個数・転換率・広告費・良い広告/悪い広告 を
#  ニュース記事の形にまとめて、デイリーニュースアプリに1本投稿します。
#
#  データ源:
#    売上・個数   … 売上明細（自動取込）
#    転換率       … out/news-cvr.json（newsCvr.js が日報アプリから出力）
#    広告         … KPIアプリ(30)の添付CSV（昨日分）
#    日次目標     … config/chorei/events-*.json（イベント加重）
#
#  実行: python3 scripts/newsDaily.py [--dry-run] [--date=YYYY-MM-DD]
#  ★書き込むのはデイリーニュースアプリだけ。他アプリは読むだけ。
# ============================================================
import base64, json, os, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adlib import (z2h, day_from_name, read_text, detect_media, sum_col,
                   daily_col, rpp_day_metrics, amazon_by_type, google_campaign_daily)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JST = timezone(timedelta(hours=9))
DRY = '--dry-run' in sys.argv

BASE = os.environ['KINTONE_BASE_URL'].rstrip('/')
AUTH = base64.b64encode(
    f"{os.environ['KINTONE_USER']}:{os.environ['KINTONE_PASSWORD']}".encode()).decode()
NEWS_APP = os.environ.get('KINTONE_NEWS_APP_ID') or ''
SALES_APP = os.environ.get('KINTONE_SALES_DETAIL_APP_ID') or ''
KPI_APP = os.environ.get('KINTONE_KPI_APP_ID') or '30'


def arg(name):
    hit = next((a for a in sys.argv if a.startswith(f'--{name}=')), None)
    return hit.split('=', 1)[1] if hit else None


def kcall(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={'X-Cybozu-Authorization': AUTH,
                 **({'Content-Type': 'application/json'} if data else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b'{}')


def kget_raw(path):
    req = urllib.request.Request(BASE + path, headers={'X-Cybozu-Authorization': AUTH})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def yen(n):
    return f'¥{n:,.0f}'


def fetch_sales(date_iso):
    """売上明細から1日分のチャネル別 売上・個数。"""
    q = urllib.parse.quote(f'report_date = "{date_iso}" limit 20')
    data = kcall('GET', f'/k/v1/records.json?app={SALES_APP}&query={q}')
    ch = {}
    for rec in data.get('records', []):
        for row in rec.get('detail', {}).get('value', []):
            v = row.get('value', {})
            c = v.get('s_channel', {}).get('value') or '不明'
            e = ch.setdefault(c, {'amount': 0, 'qty': 0})
            e['amount'] += float(v.get('s_amount', {}).get('value') or 0)
            e['qty'] += float(v.get('s_qty', {}).get('value') or 0)
    return ch


def fetch_ads(target):
    """KPIアプリの添付から対象日の広告実績。target=(y,m,d)"""
    y, m, d = target
    frm = (datetime(y, m, d) - timedelta(days=1)).strftime('%Y-%m-%d')
    q = urllib.parse.quote(f'report_date >= "{frm}" order by report_date desc limit 20')
    data = kcall('GET', f'/k/v1/records.json?app={KPI_APP}&query={q}')
    out = {}   # 'rpp' -> {...} / 'az' -> {SP: {...}} / 'trav'/'cat' -> spend / 'goog' -> {...}
    for rec in data.get('records', []):
        for field in ('file_ads', 'file_sales', 'file_other'):
            for f in rec.get(field, {}).get('value', []):
                name = f.get('name', '')
                if not name.endswith('.csv'):
                    continue
                try:
                    media, colname = detect_media(name)
                    low = z2h(name).lower()
                    if media == 'rpp' and 'rpp' not in out:
                        text = read_text(kget_raw(f"/k/v1/file.json?fileKey={f['fileKey']}"))
                        got = rpp_day_metrics(text, target)  # 日付列で対象日に絞って集計
                        if got and got['cost'] > 0:
                            out['rpp'] = got
                    elif media == 'az' and 'az' not in out:
                        if day_from_name(name, m) != d:
                            continue
                        text = read_text(kget_raw(f"/k/v1/file.json?fileKey={f['fileKey']}"))
                        got = amazon_by_type(text)
                        if got:
                            out['az'] = got
                    elif media in ('trav', 'cat') and media not in out:
                        text = read_text(kget_raw(f"/k/v1/file.json?fileKey={f['fileKey']}"))
                        daily = daily_col(text, colname)
                        if daily and (y, m, d) in daily:
                            out[media] = daily[(y, m, d)]
                        elif day_from_name(name, m) == d:
                            total = sum_col(text, colname)
                            if total is not None:
                                out[media] = total
                    elif 'google' in low and 'goog' not in out:
                        text = read_text(kget_raw(f"/k/v1/file.json?fileKey={f['fileKey']}"))
                        daily = google_campaign_daily(text)
                        if daily and (y, m, d) in daily:
                            out['goog'] = daily[(y, m, d)]
                except Exception as e:  # 1ファイル失敗しても続行
                    print(f'  ⚠ {name}: {e}')
    return out


def daily_target(date):
    """イベント加重の日次目標（1.1億ベース）。設定が無ければ None。"""
    p = os.path.join(ROOT, 'config', 'chorei', f'events-{date.strftime("%Y-%m")}.json')
    if not os.path.exists(p):
        return None
    conf = json.load(open(p, encoding='utf-8'))
    main = conf.get('targets', {}).get('main')
    if not main:
        return None
    import calendar
    dim = calendar.monthrange(date.year, date.month)[1]
    events = {int(k): v for k, v in conf.get('events', {}).items()}
    weights = [events.get(dd, {}).get('weight', 1.0) for dd in range(1, dim + 1)]
    w = events.get(date.day, {}).get('weight', 1.0)
    return main * w / sum(weights)


def build(date, sales, ads, cvr, target):
    iso = date.strftime('%Y-%m-%d')
    md = f'{date.month}/{date.day}'
    rk = sales.get('楽天', {'amount': 0, 'qty': 0})
    az = sales.get('Amazon', {'amount': 0, 'qty': 0})
    own = sales.get('自社サイト', {'amount': 0, 'qty': 0})
    total = rk['amount'] + az['amount'] + own['amount']
    units = int(rk['qty'] + az['qty'] + own['qty'])

    # 広告費（昨日ぶん・取れた媒体のみ）
    ad_items = []   # (名前, 費用, 売上, 補足)
    if 'rpp' in ads:
        r = ads['rpp']
        ad_items.append(('楽天RPP', r['cost'], r['sales'], f"クリック{r['clicks']:,}・{r['orders']}件"))
    for t, label in (('SP', 'Amazon SP'), ('SB2', 'Amazon動画(SB2)'), ('SB', 'Amazon SB'), ('SD', 'Amazon SD')):
        if 'az' in ads and t in ads['az']:
            e = ads['az'][t]
            ad_items.append((label, e['cost'], e['sales'], f"クリック{e['clicks']:,}・{e['purch']}件"))
    if 'goog' in ads:
        g = ads['goog']
        ad_items.append(('Google', int(g['cost']), int(g['convv']), f"クリック{int(g['clicks']):,}・CV{g['conv']:g}件"))
    meta_spend = sum(ads[k] for k in ('trav', 'cat') if k in ads)
    adcost = sum(c for _, c, _, _ in ad_items) + meta_spend
    ratio = (adcost / total * 100) if total else 0

    # 良い広告・悪い広告（費用3,000円以上を対象にROASで判定）
    ranked = [(n, c, s, (s / c * 100 if c else 0), note) for n, c, s, note in ad_items if c >= 3000]
    ranked.sort(key=lambda x: -x[3])
    good = [f"{n}｜ROAS {r:,.0f}%（費用{yen(c)}→売上{yen(s)}）{note}" for n, c, s, r, note in ranked[:2] if r >= 300]
    bad = [f"{n}｜ROAS {r:,.0f}%（費用{yen(c)}→売上{yen(s)}）{note}" for n, c, s, r, note in ranked[::-1][:2] if r < 300]
    good_txt = '\n'.join(good) if good else 'データ待ち（角南さんの朝の添付後に確定します）'
    bad_txt = '\n'.join(bad) if bad else 'ROAS300%を切る広告はありませんでした'

    # 判定
    if target:
        rate = total / target
        judge = '🟢 好調' if rate >= 1.0 else ('🟡 まずまず' if rate >= 0.7 else '🔴 要改善')
        target_line = f'日次目標 {yen(target)} に対して {rate * 100:.0f}%'
    else:
        judge = '🟡 まずまず'
        target_line = '日次目標: 設定なし'

    headline = f'{md}の売上は{yen(total)}（{units}個）— {target_line.split("に対して")[-1].strip() if target else ""}'
    if target:
        headline = f'{md}の売上{yen(total)}・目標比{total / target * 100:.0f}%（広告費率{ratio:.1f}%）'
    else:
        headline = f'{md}の売上{yen(total)}（広告費率{ratio:.1f}%）'

    cvr_note = ''
    if cvr:
        parts = []
        if cvr.get('rakutenCvr') is not None:
            parts.append(f"楽天CVR {cvr['rakutenCvr']}%")
        if cvr.get('amazonCvr') is not None:
            parts.append(f"Amazon CVR {cvr['amazonCvr']}%")
        cvr_note = ' / '.join(parts)
    if not cvr_note:
        cvr_note = 'データ待ち（日報の入力後に反映）'

    L = []
    L.append(f'📰 {md}のリベティニュース')
    L.append('')
    L.append(f'■ 売上 {yen(total)}（{target_line}）')
    L.append(f'　楽天 {yen(rk["amount"])} ／ Amazon {yen(az["amount"])} ／ 自社 {yen(own["amount"])}')
    L.append(f'■ 販売個数 {units}個（楽天{int(rk["qty"])}・Amazon{int(az["qty"])}・自社{int(own["qty"])}）')
    L.append(f'■ 転換率 {cvr_note}')
    L.append(f'■ 広告費 {yen(adcost)}（対売上 {ratio:.1f}%）')
    if meta_spend:
        L.append(f'　うちMeta {yen(meta_spend)}（トラベル+カタログ・効果計測は準備中）')
    L.append('')
    L.append('🏆 良い広告')
    L.append(good_txt)
    L.append('')
    L.append('⚠️ 悪い広告')
    L.append(bad_txt)
    body = '\n'.join(L)

    return {
        'news_date': {'value': iso},
        'judge': {'value': judge},
        'headline': {'value': headline[:120]},
        'sales_total': {'value': str(int(total))},
        'units_total': {'value': str(units)},
        'adcost_total': {'value': str(int(adcost))},
        'ad_ratio': {'value': f'{ratio:.1f}'},
        'cvr_note': {'value': cvr_note[:120]},
        'good_ads': {'value': good_txt},
        'bad_ads': {'value': bad_txt},
        'body': {'value': body},
    }, body


def upsert(record, iso):
    q = urllib.parse.quote(f'news_date = "{iso}" limit 1')
    hit = kcall('GET', f'/k/v1/records.json?app={NEWS_APP}&query={q}').get('records', [])
    if hit:
        rid = hit[0]['$id']['value']
        kcall('PUT', '/k/v1/record.json',
              {'app': NEWS_APP, 'id': rid, 'record': record})
        return f'更新（レコード{rid}）'
    kcall('POST', '/k/v1/record.json', {'app': NEWS_APP, 'record': record})
    return '新規投稿'


def main():
    now = datetime.now(JST)
    iso = arg('date') or (now - timedelta(days=1)).strftime('%Y-%m-%d')
    date = datetime.strptime(iso, '%Y-%m-%d')
    print(f'📰 {iso} のニュースを作ります')

    sales = fetch_sales(iso)
    ads = fetch_ads((date.year, date.month, date.day))
    cvr = None
    cp = os.path.join(ROOT, 'out', 'news-cvr.json')
    if os.path.exists(cp):
        try:
            cvr = json.load(open(cp, encoding='utf-8'))
        except Exception:
            cvr = None
    target = daily_target(date)

    record, body = build(date, sales, ads, cvr, target)
    print()
    print(body)
    print()
    if DRY:
        print('（--dry-run のため投稿しません）')
        return
    if not NEWS_APP:
        raise SystemExit('KINTONE_NEWS_APP_ID が未設定です')
    print('✅ ' + upsert(record, iso))


main()
