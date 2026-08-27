#!/usr/bin/env python3
# ============================================================
#  広告費の内訳デバッグ（1日ぶんのMeta広告費を行単位で検証）
# ------------------------------------------------------------
#  adCostReport.py と同じ手順でKPIアプリ(30)の添付CSVを読み、
#  指定日（state/adcost-debug-request.json の day）に配分された
#  トラベル/カタログの金額を「どのファイルのどの行から来たか」
#  まで分解して state/adcost-debug.txt に書き出します。
#  ★キントーンは読むだけ。数字は 0-9→A-J 置換（可逆）。
#  ★キャンペーン名などの文字列は出力しません（公開リポジトリのため）。
# ============================================================
import base64, csv, hashlib, io, json, os, re, sys, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JST = timezone(timedelta(hours=9))

BASE = os.environ['KINTONE_BASE_URL'].rstrip('/')
AUTH = base64.b64encode(f"{os.environ['KINTONE_USER']}:{os.environ['KINTONE_PASSWORD']}".encode()).decode()
KPI_APP = os.environ.get('KINTONE_KPI_APP_ID') or '30'

OUT = []


def say(s):
    OUT.append(re.sub(r'\d', lambda x: 'ABCDEFGHIJ'[int(x.group())], str(s)))


def kget(path):
    req = urllib.request.Request(BASE + path, headers={'X-Cybozu-Authorization': AUTH})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def yen_num(s):
    s = str(s).replace('￥', '').replace('¥', '').replace(',', '').replace('"', '').strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def z2h(s):
    return unicodedata.normalize('NFKC', s)


def day_from_name(name):
    m = re.search(r'8[.:：月\s]?\s*([0-3]?\d)', z2h(name))
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


def main():
    req_path = os.path.join(ROOT, 'state', 'adcost-debug-request.json')
    target_day = 26
    if os.path.exists(req_path):
        target_day = int(json.load(open(req_path, encoding='utf-8')).get('day', 26))

    now = datetime.now(JST)
    month = now.strftime('%Y-%m')
    upto = (now - timedelta(days=1)).day
    say(f'=== Meta広告費デバッグ {month}-{target_day:02d}（upto={upto}） ===')

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

    vals = {}  # adCostReport.py と同じ「最初の値を採用」の再現
    # 採用ファイルの対象日キャンペーン別合計（名前はハッシュ化して比較のみに使う）
    camp_by_media = {}
    for rec in records:
        rdate = rec.get('report_date', {}).get('value', '?')
        for field in ('file_ads', 'file_sales', 'file_other'):
            for f in rec.get(field, {}).get('value', []):
                name = f.get('name', '')
                nk = z2h(name)
                if not name.endswith('.csv'):
                    continue
                media = 'trav' if 'トラベル' in nk else ('cat' if 'カタログ' in nk else None)
                if not media:
                    continue
                day = day_from_name(name)
                say(f'--- file media={media} 記録日={rdate} 名前日={day} field={field} bytes=?')
                if day and (day > upto or (media, day) in vals):
                    say(f'    → adCostReportではスキップ扱い（名前日{day}は取込済みor未来）')
                text = read_text(kget(f"/k/v1/file.json?fileKey={f['fileKey']}"))
                rows = list(csv.reader(io.StringIO(text)))
                hdr = next((r for r in rows if any('消化金額' in c for c in r)), None)
                if not hdr:
                    say('    消化金額列なし')
                    continue
                i = next(j for j, c in enumerate(hdr) if '消化金額' in c)
                di = next((j for j, c in enumerate(hdr) if 'レポート開始日' in c or c.strip() == '日付'), None)
                say(f'    列: {" | ".join(z2h(c) for c in hdr[:8])}')
                if di is None:
                    say('    日付列なし（ファイル名の日付で1日にまとめて計上される）')
                    total = int(sum(yen_num(r[i]) for r in rows[rows.index(hdr) + 1:]
                                    if len(r) > i and str(r[i]).strip()))
                    say(f'    合計={total} → 名前日{day}に計上')
                    if day and day <= upto and (media, day) not in vals:
                        vals[(media, day)] = total
                    continue
                # 日付列がある場合: 対象日の行を1行ずつ出す
                # 名前列（キャンペーン名/広告セット名）をキーワードだけで分類する
                # （名称そのものは公開リポジトリに出さない）
                ni = next((j for j, c in enumerate(hdr)
                           if 'キャンペーン名' in c or '広告セット名' in c), None)
                # キャンペーン名の列（広告セット単位のCSVにも通常含まれる）
                ci = next((j for j, c in enumerate(hdr) if c.strip() == 'キャンペーン名'), None)
                say(f'    キャンペーン名列={ci if ci is not None else "なし"} 全列数={len(hdr)}')
                classes = {}
                camp = {}
                day_sum = {}
                tcnt = 0
                for r in rows[rows.index(hdr) + 1:]:
                    if len(r) <= max(i, di) or not str(r[i]).strip():
                        continue
                    ds = re.findall(r'(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})', z2h(str(r[di])))
                    if len(ds) >= 2 and ds[0] != ds[1]:
                        say(f'    期間まとめ行を除外: {z2h(str(r[di]))} 金額={int(yen_num(r[i]))}')
                        continue
                    d = parse_date(r[di])
                    if not d:
                        continue
                    day_sum[d] = day_sum.get(d, 0) + yen_num(r[i])
                    if d[0:2] == tuple(int(x) for x in month.split('-')) and d[2] == target_day:
                        tcnt += 1
                        first_empty = 'Y' if not str(r[0]).strip() else 'N'
                        say(f'    行: 日付={r[di]} 金額={int(yen_num(r[i]))} 先頭列空={first_empty} 列数={len(r)}')
                        nm = z2h(str(r[ni])) if ni is not None and len(r) > ni else ''
                        cls = ('カタログ' if 'カタログ' in nm else
                               'トラベル' if 'トラベル' in nm else
                               '空欄' if not nm.strip() else 'その他')
                        c = classes.setdefault(cls, [0, 0.0])
                        c[0] += 1
                        c[1] += yen_num(r[i])
                        if ci is not None and len(r) > ci:
                            h = hashlib.md5(z2h(str(r[ci])).strip().encode()).hexdigest()[:6]
                            camp[h] = camp.get(h, 0) + yen_num(r[i])
                say(f'    このファイルの日別合計（当月分のみ）:')
                for d in sorted(day_sum):
                    if d[0:2] == tuple(int(x) for x in month.split('-')):
                        adopted = ''
                        if d[2] <= upto and (media, d[2]) not in vals:
                            vals[(media, d[2])] = int(day_sum[d])
                            adopted = ' ←採用'
                        say(f'      {d[0]}-{d[1]:02d}-{d[2]:02d}: {int(day_sum[d])}{adopted}')
                say(f'    対象日{target_day}の行数={tcnt}')
                for cls, (cnt, amt) in sorted(classes.items()):
                    say(f'    対象日の内訳[{cls}]: {cnt}行 {int(amt)}円')
                if tcnt and camp and media not in camp_by_media:
                    camp_by_media[media] = camp

    say('=== 採用結果（対象日） ===')
    for media in ('trav', 'cat'):
        say(f'{media} day{target_day} = {vals.get((media, target_day), "なし")}')

    # トラベル/カタログ両ファイルに同じキャンペーンが入っていないか（二重計上検出）
    say('=== キャンペーン重複チェック（名前はハッシュ比較のみ） ===')
    t, c = camp_by_media.get('trav', {}), camp_by_media.get('cat', {})
    say(f'trav側キャンペーン数={len(t)} cat側キャンペーン数={len(c)}')
    shared = set(t) & set(c)
    say(f'両方に含まれるキャンペーン数={len(shared)}')
    for h in sorted(shared):
        say(f'  {h}: trav側={int(t[h])}円 cat側={int(c[h])}円')
    if shared:
        say(f'重複ぶんの合計: trav側={int(sum(t[h] for h in shared))}円'
            f' cat側={int(sum(c[h] for h in shared))}円')

    out_path = os.path.join(ROOT, 'state', 'adcost-debug.txt')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(OUT) + '\n')
    print(f'書き出し: {out_path}（{len(OUT)}行）')


main()
