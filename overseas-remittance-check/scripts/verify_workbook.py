#!/usr/bin/env python3
"""生成したExcelブックの数式を、実際に計算して検証する。

openpyxlは数式を文字列として書くだけで計算結果を持たせないため、
「数式が入っている」ことと「その数式が正しく動く」ことは別物になる。
ここで全数式を評価し、エラーにならないこと・期待した値になることを確かめる。

LibreOffice がこの環境では起動段階でハングするため、純Pythonの評価器を使う。

    python3 scripts/verify_workbook.py 送金チェック.xlsx

終了コード: 0=問題なし / 1=エラーあり
"""

import argparse
import re
import sys
from pathlib import Path

import openpyxl

ERR = re.compile(r"#(REF|VALUE|NAME|DIV/0|N/A|NULL|NUM)")


def evaluate(path):
    """全セルの計算結果を {(シート名, セル座標): 値} で返す。"""
    import formulas
    model = formulas.ExcelModel().loads(str(path)).finish()
    sol = model.calculate()
    book = Path(path).name
    out = {}
    for key, val in sol.items():
        m = re.fullmatch(rf"'\[{re.escape(book)}\](.+)'!([A-Z]+\d+)", str(key))
        if not m:
            continue
        try:
            v = val.value[0, 0]
        except Exception:
            v = val
        out[(m.group(1), m.group(2))] = v
    return out


def main():
    ap = argparse.ArgumentParser(description="Excelブックの数式を実際に計算して検証する")
    ap.add_argument("workbook")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.workbook)
    formulas_by_cell = {
        (ws.title, c.coordinate): c.value
        for ws in wb
        for row in ws.iter_rows()
        for c in row
        if isinstance(c.value, str) and c.value.startswith("=")
    }
    print(f"数式セル: {len(formulas_by_cell)}件")
    if not wb.calculation.fullCalcOnLoad:
        print("警告: fullCalcOnLoad が立っていない。"
              "開いた側が再計算するまで数式セルが空に見えることがある。")

    results = evaluate(args.workbook)

    problems = []
    for (sheet, coord), src in sorted(formulas_by_cell.items()):
        value = results.get((sheet, coord))
        text = "" if value is None else str(value)
        if value is None:
            problems.append((sheet, coord, "評価されなかった", src))
        elif ERR.search(text):
            problems.append((sheet, coord, text, src))
        elif args.verbose:
            print(f"  {sheet}!{coord} = {text[:70]}")

    if problems:
        print(f"\n❌ 問題のある数式: {len(problems)}件")
        for sheet, coord, value, src in problems:
            print(f"  {sheet}!{coord}  結果={value}")
            print(f"      {src[:110]}")
        return 1

    print(f"✅ 全{len(formulas_by_cell)}式がエラーなく評価された")

    # 照合列がすべて一致になっているか（1つでも不一致なら書類の中身に食い違いがある）
    mismatch = [(s, c, str(v)) for (s, c), v in results.items()
                if s == "照合結果" and c.startswith("D") and isinstance(v, str)
                and ("❌" in v or "未入力" in str(v))]
    if mismatch:
        print(f"\n⚠ 照合列に一致しない行がある: {len(mismatch)}件")
        for s, c, v in mismatch:
            print(f"  {s}!{c} = {v}")
    else:
        print("✅ 照合列はすべて一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
