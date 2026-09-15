#!/usr/bin/env python3
"""パッキングリストとBL/アライバルの数量が一致しているか照合する。

  python3 scripts/checkDocQty.py

packing-lists/ の各パッキングリストから「合计」行の数量を読み、
data/bl-info.json の total_cartons（BL/ANから転記した個数）と突き合わせる。
差異があれば ❌ で表示するので、書類を受け取ったら毎回これを回す。

BL/ANの数量は bl-info.json の total_cartons に入れておくこと。
より厳密に3点を残したい場合は qty_check を入れる:
  "qty_check": {"packing_list": 607, "bl": 607, "arrival_notice": 607}
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
PL_DIR = os.path.join(ROOT, 'packing-lists')


def rows_of(path):
    """パッキングリストの全セルを行ごとの文字列リストで返す。"""
    if path.endswith('.xls'):
        import xlrd
        wb = xlrd.open_workbook(path)
        for sh in wb.sheets():
            for r in range(sh.nrows):
                yield [sh.cell_value(r, c) for c in range(sh.ncols)]
    else:
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True)
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                yield list(row)


# 「段ボール箱」など、資材だけの行は合计に含まれないので明細合計から除く
PACKAGING = ('段ボール', 'ダンボール', '纸箱')


def parse_packing_list(path):
    """コンテナ番号 → {'total':合計個数, 'sum':明細合計, 'stated':合计行の値}。

    1ファイルに複数コンテナがある場合も拾う。「合计」行が無い
    （ラベル無しの小計行だけの）パッキングリストにも対応する。
    """
    result = {}
    current = None
    c_name = c_qty = None

    def bucket(container):
        return result.setdefault(container, {'sum': 0, 'stated': None})

    for row in rows_of(path):
        cells = ['' if v is None else str(v).strip() for v in row]

        # ヘッダー行（数量（个）の列位置を覚える）
        if any('数量' in v for v in cells):
            for i, v in enumerate(cells):
                if '数量' in v:
                    c_qty = i
                if '品名' in v:
                    c_name = i
            continue

        # コンテナ番号（英4文字＋数字7桁）
        for v in cells:
            if re.fullmatch(r'[A-Z]{4}\d{7}', v):
                current = v
                bucket(current)

        if current is None or c_qty is None or c_qty >= len(cells):
            continue

        try:
            qty = float(cells[c_qty])
        except ValueError:
            continue
        if qty <= 0 or abs(qty - round(qty)) > 1e-9:
            continue
        qty = int(round(qty))

        name = cells[c_name] if c_name is not None and c_name < len(cells) else ''
        is_total = (not name) or any('合计' in v or '合計' in v for v in cells)
        b = bucket(current)
        if is_total:
            b['stated'] = qty
        elif not any(p in name for p in PACKAGING):
            b['sum'] += qty

    for b in result.values():
        b['total'] = b['stated'] if b['stated'] is not None else b['sum']
    return result


def main():
    with open(os.path.join(DATA, 'bl-info.json'), encoding='utf-8') as f:
        bl = {k: v for k, v in json.load(f).items()
              if isinstance(v, dict) and not k.startswith('_')}

    pl_qty, inner = {}, []
    for path in sorted(glob.glob(os.path.join(PL_DIR, '*.xls*'))):
        src = os.path.basename(path)
        for container, b in parse_packing_list(path).items():
            if not b['total']:
                continue
            pl_qty[container] = (b['total'], src)
            if b['stated'] is not None and b['stated'] != b['sum']:
                inner.append((container, b['sum'], b['stated'], src))

    print(f"{'コンテナ':16s}{'PL':>8s}{'BL/AN':>8s}{'判定':>8s}  出典")
    print('-' * 72)
    ng, checked, missing = [], 0, []
    for container in sorted(set(pl_qty) | set(bl)):
        p = pl_qty.get(container)
        b = bl.get(container, {}).get('total_cartons')
        if p is None:
            missing.append((container, 'パッキングリスト未登録'))
            continue
        if b is None:
            missing.append((container, 'BL/ANの個数(total_cartons)未登録'))
            continue
        ok = (p[0] == b)
        checked += 1
        if not ok:
            ng.append((container, p[0], b))
        print(f"{container:16s}{p[0]:8,d}{b:8,d}{'⭕️一致' if ok else '❌不一致':>8s}  {p[1]}")

    print('-' * 72)
    print(f'照合 {checked} 件 / 不一致 {len(ng)} 件')
    for c, p, b in ng:
        print(f'  ❌ {c}: パッキングリスト {p:,} 個 ≠ BL/AN {b:,} 個（差 {p - b:+,}）')
    if inner:
        print('\n― パッキングリスト内部の不一致（明細の合計 ≠ 合计行）―')
        for c, s, st, src in inner:
            print(f'  ❌ {c}: 明細合計 {s:,} 個 ≠ 合计 {st:,} 個（差 {s - st:+,}）  {src}')
    if missing:
        print('\n― 照合できなかったもの ―')
        for c, why in missing:
            print(f'  ・{c}: {why}')
    return 1 if ng or inner else 0


if __name__ == '__main__':
    sys.exit(main())
