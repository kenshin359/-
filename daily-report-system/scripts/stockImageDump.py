#!/usr/bin/env python3
# ============================================================
#  在庫報告の添付画像の取り出し（在庫Excelの事務所在庫欄用）
# ------------------------------------------------------------
#  最新日の在庫報告（アプリ35）に添付された画像（事務所在庫の
#  スクリーンショット）を縮小・圧縮してbase64でログに出します。
#  ★キントーンは読むだけ。取得後はログを削除する運用です。
#
#  実行: python3 scripts/stockImageDump.py [--index=0]
# ============================================================
import base64
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from PIL import Image

BASE = os.environ['KINTONE_BASE_URL'].rstrip('/')
AUTH = base64.b64encode(
    f"{os.environ['KINTONE_USER']}:{os.environ['KINTONE_PASSWORD']}".encode()).decode()
APP = os.environ.get('KINTONE_STOCK_REPORT_APP_ID') or '35'
JST = timezone(timedelta(hours=9))

MAX_DIM = 1400
QUALITY = 68
LINE = 8000


def kget(path):
    req = urllib.request.Request(BASE + path, headers={'X-Cybozu-Authorization': AUTH})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    idx_arg = next((a for a in sys.argv if a.startswith('--index=')), None)
    only = int(idx_arg.split('=')[1]) if idx_arg else None

    since = (datetime.now(JST) - timedelta(days=5)).strftime('%Y-%m-%d')
    q = urllib.parse.quote(f'report_date >= "{since}" order by report_date desc limit 30')
    records = json.loads(kget(f'/k/v1/records.json?app={APP}&query={q}')).get('records', [])
    if not records:
        print('在庫報告がありません')
        return
    latest = records[0]['report_date']['value']
    target = [r for r in records if r['report_date']['value'] == latest]

    images = []
    for rec in target:
        for f in rec.get('file_stock', {}).get('value', []):
            if re.search(r'\.(png|jpe?g)$', f.get('name', ''), re.I):
                images.append(f)
    images.sort(key=lambda f: f.get('name', ''))
    print(f'IMAGES_TOTAL={len(images)}')

    for i, f in enumerate(images):
        if only is not None and i != only:
            continue
        raw = kget(f"/k/v1/file.json?fileKey={f['fileKey']}")
        img = Image.open(io.BytesIO(raw)).convert('RGB')
        img.thumbnail((MAX_DIM, MAX_DIM))
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=QUALITY, optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode()
        print(f'===IMG=== index={i} bytes={len(buf.getvalue())} size={img.size}')
        print('===IMG_B===')
        for j in range(0, len(b64), LINE):
            print(b64[j:j + LINE])
        print('===IMG_END===')


main()
