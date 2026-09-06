#!/usr/bin/env python3
"""送金チェック結果をExcelブックにまとめる。

検証エンジンとPDF読み取りの出力からそのまま組み立てるので、
値を手で打ち直す工程がない（打ち直せばそこが新しい誤りの入口になる）。

    python3 scripts/build_check_sheet.py data/OMT20260901100481.json \
        --pdf samples/remittance.pdf -o 送金チェック_OMT20260901100481.xlsx

シートは5枚。

  サマリー      … 送金の基本情報、判定件数、円貨相当額の試算
  照合結果      … 申込書と先方シート、申込書PDFと入力データの突き合わせ
  検証結果      … 検出した指摘の一覧
  実行前チェック … 送金前に人が潰す項目（記入用）
  商材別輸入要件 … 商材ごとのHSコード候補と必要な手続

一致判定はExcelの数式で行う。値をセルに書き換えれば判定もその場で変わるので、
このブック自体が確認用のツールとして使える。
"""

import argparse
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_remittance as vr  # noqa: E402

FONT = "Meiryo"

NAVY = "1F3864"
GREY = "D9D9D9"
LIGHT = "F2F2F2"
YELLOW = "FFF2CC"     # 記入してもらうセル
RED = "FFC7CE"
AMBER = "FFEB9C"
BLUE_TXT = "0000FF"   # 手入力の値
GREEN_OK = "C6EFCE"

THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def norm_expr(ref):
    """セル参照を、空白・カンマ・ピリオド・ハイフンを無視した大文字表記に変換する数式片。

    書類の間では 'CO., LTD.' と 'CO.,LTD' のような表記ゆれが普通に出る。
    そこを不一致として騒ぐと、本当の不一致が埋もれる。
    日付の 2026/09/03 と 2026-09-03 も同じものとして扱う。
    """
    e = f'TRIM({ref})'
    for ch in (" ", ",", ".", "-", "/"):
        e = f'SUBSTITUTE({e},"{ch}","")'
    return f"UPPER({e})"


def match_formula(a, b):
    """2つのセルが（表記ゆれを無視して）一致するかを判定する数式。"""
    return (f'=IF(OR({a}="",{b}=""),"－ 未入力",'
            f'IF(EXACT({norm_expr(a)},{norm_expr(b)}),"✅ 一致","❌ 要確認"))')


def numeric_match_formula(text_cell, num_cell):
    """片方が「238,537.00」という文字列、片方が数値のときの一致判定。

    文字列として比べると桁区切りや小数点の有無で必ず食い違うので、数値に直して比べる。
    """
    return (f'=IFERROR(IF(ABS(VALUE(SUBSTITUTE({text_cell},",",""))-{num_cell})<0.005,'
            f'"✅ 一致","❌ 要確認"),"❌ 要確認")')


def contains_formula(a, b):
    """aの内容がbに含まれるか。住所のように片方が長い場合に使う。"""
    return (f'=IF(OR({a}="",{b}=""),"－ 未入力",'
            f'IF(ISNUMBER(SEARCH({norm_expr(a)},{norm_expr(b)})),"✅ 一致（包含）","❌ 要確認"))')


# ------------------------------------------------------------------ 体裁

def style_sheet(ws, widths, freeze="A1"):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = freeze
    ws.sheet_view.showGridLines = False


def title(ws, row, text, span, subtitle=None):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(name=FONT, size=14, bold=True, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor=NAVY)
    c.alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[row].height = 28
    if subtitle:
        ws.merge_cells(start_row=row + 1, start_column=1, end_row=row + 1, end_column=span)
        s = ws.cell(row=row + 1, column=1, value=subtitle)
        s.font = Font(name=FONT, size=9, color="595959")
        s.alignment = Alignment(vertical="center", indent=1)
        return row + 2
    return row + 1


def header(ws, row, labels, start=1):
    for i, label in enumerate(labels):
        c = ws.cell(row=row, column=start + i, value=label)
        c.font = Font(name=FONT, size=10, bold=True)
        c.fill = PatternFill("solid", fgColor=GREY)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
    ws.row_dimensions[row].height = 22
    return row + 1


def cell(ws, row, col, value, *, bold=False, wrap=True, fill=None,
         color=None, size=10, align="left", fmt=None):
    c = ws.cell(row=row, column=col, value=value)
    c.font = Font(name=FONT, size=size, bold=bold, color=color)
    c.alignment = Alignment(horizontal=align, vertical="top" if wrap else "center",
                            wrap_text=wrap)
    c.border = BOX
    if fill:
        c.fill = PatternFill("solid", fgColor=fill)
    if fmt:
        c.number_format = fmt
    return c


def section(ws, row, text, span):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(name=FONT, size=11, bold=True, color=NAVY)
    c.fill = PatternFill("solid", fgColor=LIGHT)
    c.alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[row].height = 20
    return row + 1


# ------------------------------------------------------------------ 各シート

def build_summary(wb, tx, findings):
    ws = wb.create_sheet("サマリー")
    style_sheet(ws, [22, 34, 20, 20, 26], freeze="A3")
    amount = tx["amount"]["value"]

    r = title(ws, 1, "海外送金 事前チェック  サマリー",
              5, f"受付番号 {tx['reference_no']}／百十四銀行 {tx['branch']['name']}支店"
                 f"／作成元: {Path(__file__).name}")
    r += 1

    r = section(ws, r, "1. 送金の基本情報", 5)
    basics = [
        ("受付番号", tx["reference_no"]),
        ("ステータス", tx["status"]),
        ("送金指定日", tx["value_date"]),
        ("送金金額", f"{tx['amount']['currency']} {amount:,.2f}"),
        ("決済方法", f"{tx['settlement_method']}（為替予約なし）"
                     if not tx.get("fx_contract_no") else tx["settlement_method"]),
        ("海外銀行手数料", "送金人負担（DEBTOR / OUR）→ 受取人に満額が届く"
                           if tx["foreign_bank_charges"] == "DEBTOR"
                           else tx["foreign_bank_charges"]),
        ("送金人", f"{tx['debtor']['name']}（{tx['debtor']['country']}）"),
        ("受取人", f"{tx['creditor']['name']}（{tx['creditor']['country']}）"),
        ("受取人口座", tx["creditor_account"]),
        ("受取銀行", f"{tx['creditor_agent']['name']}／BIC {tx['creditor_agent']['bic']}"),
        ("送金目的", f"{tx['purpose']['category']}／{tx['purpose']['details']}"),
        ("原産地・船積地", f"{tx['purpose']['origin']}／{tx['purpose']['port_of_loading']}"),
    ]
    for label, value in basics:
        cell(ws, r, 1, label, bold=True, fill=LIGHT, wrap=False)
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=5)
        cell(ws, r, 2, value, wrap=False)
        for c in range(2, 6):
            ws.cell(row=r, column=c).border = BOX
        r += 1
    r += 1

    r = section(ws, r, "2. 判定", 5)
    r = header(ws, r, ["区分", "件数", "意味", "", ""])
    counts_start = r
    for label, meaning in (("🔴 送金停止", "解消しないまま送金してはいけない"),
                           ("🟡 要確認", "確認のうえ承認する"),
                           ("🔵 参考", "把握しておく")):
        cell(ws, r, 1, label, bold=True, wrap=False)
        cell(ws, r, 2, f'=COUNTIF(検証結果!$A:$A,"{label}")',
             align="center", bold=True, wrap=False, fmt="0")
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=5)
        cell(ws, r, 3, meaning, wrap=False)
        for c in range(3, 6):
            ws.cell(row=r, column=c).border = BOX
        r += 1
    ws.cell(row=counts_start, column=1).fill = PatternFill("solid", fgColor=RED)
    ws.cell(row=counts_start + 1, column=1).fill = PatternFill("solid", fgColor=AMBER)

    cell(ws, r, 1, "総合判定", bold=True, fill=LIGHT, wrap=False)
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=5)
    cell(ws, r, 2,
         f'=IF(B{counts_start}>0,"送金不可。🔴"&B{counts_start}&"件を解消してから再判定すること。",'
         f'IF(B{counts_start+1}>0,"条件付き可。🟡"&B{counts_start+1}&"件を確認のうえ承認すること。",'
         f'"問題なし。"))',
         bold=True, wrap=False)
    for c in range(2, 6):
        ws.cell(row=r, column=c).border = BOX
    r += 2

    r = section(ws, r, "3. 円貨相当額の試算（為替予約なしのため実行日の相場で決まる）", 5)
    r = header(ws, r, ["", "想定レート（円/USD）", "円貨相当額", "基準との差", "備考"])

    # 送金額を1つのセルに置き、下の各レート行がそこを参照する。
    # レート行に金額を直書きすると、金額を直したとき試算が古いままになる。
    amount_row = r
    cell(ws, r, 1, "送金金額", bold=True, wrap=False)
    cell(ws, r, 2, tx["amount"]["currency"], align="center", wrap=False)
    cell(ws, r, 3, amount, align="right", wrap=False, fmt="#,##0.00", color=BLUE_TXT)
    cell(ws, r, 4, "", wrap=False)
    cell(ws, r, 5, "申込書の送金金額。手数料別。", wrap=False, size=9)
    r += 1

    rate_rows = []
    for label, rate, note in (
            ("下限想定", 145, "レートが円高に振れた場合"),
            ("基準", 150, "この行を基準に差額を計算する"),
            ("上限想定", 155, "レートが円安に振れた場合"),
            ("上限想定+", 160, "さらに円安に振れた場合")):
        cell(ws, r, 1, label, bold=True, wrap=False)
        cell(ws, r, 2, rate, align="center", wrap=False, fmt="#,##0",
             color=BLUE_TXT, fill=YELLOW)
        cell(ws, r, 3, f"=$C${amount_row}*B{r}", align="right", wrap=False, fmt="¥#,##0")
        cell(ws, r, 5, note, wrap=False, size=9)
        rate_rows.append(r)
        r += 1

    base_row = rate_rows[1]  # 「基準」の行
    for rr in rate_rows:
        cell(ws, rr, 4, f"=C{rr}-C${base_row}", align="right", wrap=False,
             fmt="¥#,##0;▲¥#,##0;-")

    r += 1
    cell(ws, r, 1, "凡例", bold=True, wrap=False)
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=5)
    cell(ws, r, 2, "黄色のセルは書き換えて使う入力欄。青字は手入力値、黒字は数式。",
         wrap=False, size=9)
    for c in range(2, 6):
        ws.cell(row=r, column=c).border = BOX
    return ws


def build_reconciliation(wb, tx, pdf_data):
    ws = wb.create_sheet("照合結果")
    style_sheet(ws, [24, 42, 42, 18, 40], freeze="A4")

    r = title(ws, 1, "書類の突き合わせ", 5,
              "判定はExcelの数式。空白・カンマ・ピリオド・ハイフンの違いは無視して比較している。"
              "値を書き換えれば判定もその場で変わる。")
    r += 1

    r = section(ws, r, "A. 申込書 ⇔ 先方提出シート（HUGH TRADING LIMITED / DBS Bank）", 5)
    r = header(ws, r, ["項目", "申込書（百十四銀行）", "先方提出シート", "判定", "備考"])

    creditor = tx["creditor"]
    agent = tx["creditor_agent"]
    rows_a = [
        ("受取人名", creditor["name"], "HUGH TRADING LIMITED", "exact", ""),
        ("受取人国名", creditor["country"], "HONGKONG", "exact", ""),
        ("受取人住所",
         f"{creditor['street']} {creditor['town']}",
         "FLAT 1019B ,10/F,LIVEN HOUSE,NO.61-63 KING YIP STREEK KWUN TONG,KOWLOON,HONGKONG.",
         "contains",
         "先方シート側は末尾にHONGKONGが付くため包含で判定。"
         "なお両書類とも KING YIP STREEK と綴られているが、実在の街路名は King Yip Street（観塘・京業街）。"
         "着金には影響しないが次回訂正を確認する。"),
        ("受取人口座", tx["creditor_account"], "79969931316469", "exact",
         "1桁でも違えば着金しないか他人の口座に入る。最重要項目。"),
        ("BIC(SWIFT)", agent["bic"], "DHBKHKHH", "exact",
         "11桁を求められたら DHBKHKHHXXX。DBS香港はDHBKHKHH、DBSシンガポール(DBSSSGSG)とは別法人。"),
        ("送金先銀行名", agent["name"], "DBS Bank (Hong Kong) Limited", "exact", ""),
    ]
    for label, a, b, mode, note in rows_a:
        cell(ws, r, 1, label, bold=True)
        cell(ws, r, 2, a)
        cell(ws, r, 3, b)
        f = match_formula(f"B{r}", f"C{r}") if mode == "exact" else contains_formula(f"B{r}", f"C{r}")
        cell(ws, r, 4, f, align="center", bold=True)
        cell(ws, r, 5, note, size=9)
        r += 1

    # 銀行住所は両書類で記載順が違うだけなので、数式ではなく目視確認とする。
    cell(ws, r, 1, "送金先銀行住所", bold=True)
    cell(ws, r, 2, f"{agent['building_number']} {agent['building_name']}, {agent['street']}, "
                   f"{agent['floor']}, {agent['town']}, {agent['country_sub_division']}")
    cell(ws, r, 3, "11th Floor, The Center, 99 Queen's Road Central, Central, Hong Kong")
    cell(ws, r, 4, "△ 目視確認", align="center", bold=True, fill=AMBER)
    cell(ws, r, 5, "記載順が違うだけで内容は同じ（11F／The Center／99 Queen's Road／Central）。"
                   "語順が異なるため数式では判定せず、目視で確認する。", size=9)
    r += 1
    cell(ws, r, 1, "Sort code / Branch code", bold=True)
    cell(ws, r, 2, "（申込書では未記入）")
    cell(ws, r, 3, "016 / 478")
    cell(ws, r, 4, "－ 参考", align="center", bold=True)
    cell(ws, r, 5, "BICを指定しているため通常は不要。銀行から求められた場合に使う。"
                   "なお 478 は百十四銀行の店番とは無関係の偶然の一致。", size=9)
    r += 2

    r = section(ws, r, "B. 申込書PDF ⇔ 入力データ（転記ミスの検出）", 5)
    r = header(ws, r, ["項目", "申込書PDFから読み取った値", "入力データ(JSON)", "判定", "備考"])

    if pdf_data:
        matched, mismatches = vr_compare(pdf_data, tx)
        notes = {
            "送金金額": "文字列と数値のため、数値に直して比較している。",
            "送金指定日": "区切り文字（/ と -）の違いは無視して比較している。",
            "海外銀行手数料": "PDF側はチェックボックスのインク量から判定した値。",
            "送金目的": "PDF側はチェックボックスのインク量から判定した値。",
        }
        for label, from_pdf, from_json, bad in (
                [(m[0], m[1], m[2], False) for m in matched]
                + [(m[0], m[1], m[2], True) for m in mismatches]):
            cell(ws, r, 1, label, bold=True)
            cell(ws, r, 2, from_pdf if from_pdf is not None else "")
            cell(ws, r, 3, from_json if from_json is not None else "")
            if label == "送金金額":
                f = numeric_match_formula(f"B{r}", f"C{r}")
            else:
                f = match_formula(f"B{r}", f"C{r}")
            cell(ws, r, 4, f, align="center", bold=True)
            cell(ws, r, 5,
                 "PDFと入力データが食い違っている。入力を直すこと。" if bad
                 else notes.get(label, ""),
                 size=9, fill=RED if bad else None)
            r += 1
        cell(ws, r, 1, "", wrap=False)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
        cell(ws, r, 1,
             f"PDFから座標で直接読み取った{len(matched) + len(mismatches)}項目を、"
             "人が入力したJSONと突き合わせている。"
             "検証エンジンがどれだけ厳密でも、入力の時点で数字を写し間違えていれば"
             "その誤りごと正しいと判定してしまう。ここはその工程。", size=9)
    else:
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
        cell(ws, r, 1, "PDFを指定せずに生成したため、転記チェックは未実施。"
                       "--pdf で申込書PDFを渡すと自動で埋まる。", size=9, fill=AMBER)
    return ws


def vr_compare(pdf_data, tx):
    import extract_pdf
    return extract_pdf.compare(pdf_data, tx)


def build_findings(wb, findings):
    ws = wb.create_sheet("検証結果")
    style_sheet(ws, [14, 12, 34, 58, 58], freeze="A4")

    r = title(ws, 1, "検証結果", 5,
              "verify_remittance.py の出力。🔴 をすべて解消してから承認に回すこと。")
    r += 1
    head = r
    r = header(ws, r, ["判定", "コード", "指摘", "内容", "対応"])

    for f in findings:
        label = vr.LABEL[f.severity]
        fill = {vr.BLOCK: RED, vr.WARN: AMBER, vr.INFO: None}[f.severity]
        cell(ws, r, 1, label, bold=True, fill=fill, align="center", size=9)
        cell(ws, r, 2, f.code, align="center", size=9)
        cell(ws, r, 3, f.title, bold=(f.severity == vr.BLOCK))
        cell(ws, r, 4, f.detail, size=9)
        cell(ws, r, 5, f.action or "", size=9)
        r += 1

    ws.auto_filter.ref = f"A{head}:E{r - 1}"
    return ws


def build_checklist(wb, tx):
    ws = wb.create_sheet("実行前チェック")
    style_sheet(ws, [6, 16, 56, 12, 16, 14, 40], freeze="A5")

    r = title(ws, 1, "送金実行前チェックリスト", 7,
              "「完了」欄はドロップダウンから選ぶ。黄色のセルが記入欄。")
    r += 1

    cell(ws, r, 1, "進捗", bold=True, fill=LIGHT, wrap=False)
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3)
    cell(ws, r, 2,
         '=COUNTIF($D$7:$D$100,"済")&" / "&COUNTA($C$7:$C$100)&" 件 完了"'
         '&IF(COUNTIF($D$7:$D$100,"未")>0,"（未完了 "&COUNTIF($D$7:$D$100,"未")&" 件）","")',
         bold=True, wrap=False)
    ws.cell(row=r, column=3).border = BOX
    cell(ws, r, 4, '=IFERROR(COUNTIF($D$7:$D$100,"済")/COUNTA($C$7:$C$100),0)',
         align="center", bold=True, wrap=False, fmt="0.0%")
    ws.merge_cells(start_row=r, start_column=5, end_row=r, end_column=7)
    cell(ws, r, 5, '=IF(COUNTIF($D$7:$D$100,"済")=COUNTA($C$7:$C$100),'
                   '"全項目完了。承認に回せる。","未完了の項目がある。送金しないこと。")',
         bold=True, wrap=False)
    for c in range(5, 8):
        ws.cell(row=r, column=c).border = BOX
    r += 2
    r = header(ws, r, ["No", "区分", "確認項目", "完了", "確認者", "確認日", "備考"])
    # 上の進捗集計は $C$7:$D$100 を固定で参照しているので、開始行がずれたら気づけるようにする。
    assert r == 7, f"チェック項目の開始行が想定と違う: {r}（進捗集計の参照範囲と不整合）"

    items = [
        ("🔴 必須", "INVOICE（またはProforma Invoice）の現物を確認した", ""),
        ("🔴 必須", "INVOICE金額 = USD 238,537.00 であることを確認した",
         "一致しなければ送金しない"),
        ("🔴 必須", "INVOICE記載の支払先口座 = 79969931316469 であることを確認した", ""),
        ("🔴 必須", "INVOICEの品目と送金理由の記載範囲が合っている",
         "スーツケース単体か、合算払いかを確定させる"),
        ("🔴 必須", "登録済み電話番号(18620073517)へ架電し、受取人名・口座番号・BICを口頭確認した",
         "メールに書かれた番号は使わない"),
        ("🔴 必須", "config/beneficiaries.json の verification を更新した", ""),
        ("🟡 記入", "申込書の「お申込日」を記入した", "現在空欄"),
        ("🟡 記入", "申込書の「仕向地(PORT OF DESTINATION)」を記入した",
         "船積地のみ記入済み。B/Lに合わせる"),
        ("🟡 記入", "申込書の「参照番号／お客様整理番号」にINVOICE番号を入れた",
         "入金消込と後日の突合が楽になる"),
        ("🟡 確認", "引落口座に円貨相当額（約3,600万円）以上の残高がある",
         "為替予約なしのため実行日の相場次第"),
        ("🟡 確認", "添付書類の内容が金額・受取人・品目と一致している",
         "申込書は「添付ファイル あり」"),
        ("🟡 確認", "第三国決済の説明資料（契約書またはINVOICE上の支払先明記）を用意した",
         "中国仕入・香港払い。銀行のAML照会と税務調査で求められる"),
        ("🟡 確認", "extract_pdf.py --check が全項目一致になる", ""),
        ("🟡 確認", "verify_remittance.py の🔴が0件になる", ""),
        ("🟡 承認", "承認者が承認した（送金指定日 2026-09-03 の受付時限まで）",
         "現在のステータスは「承認待ち」"),
    ]
    first = r
    for i, (kind, text, note) in enumerate(items, start=1):
        cell(ws, r, 1, i, align="center", wrap=False, size=9)
        cell(ws, r, 2, kind, align="center", size=9, bold=True,
             fill=RED if kind.startswith("🔴") else AMBER)
        cell(ws, r, 3, text)
        cell(ws, r, 4, "未", align="center", fill=YELLOW, color=BLUE_TXT, wrap=False)
        cell(ws, r, 5, "", fill=YELLOW, wrap=False)
        cell(ws, r, 6, "", fill=YELLOW, wrap=False, fmt="yyyy/mm/dd")
        cell(ws, r, 7, note, size=9)
        r += 1

    dv = DataValidation(type="list", formula1='"未,済,対象外"', allow_blank=True,
                        showDropDown=False)
    dv.error = "「未」「済」「対象外」から選ぶこと。"
    ws.add_data_validation(dv)
    dv.add(f"D{first}:D{r - 1}")

    return ws


def build_products(wb, products):
    ws = wb.create_sheet("商材別輸入要件")
    style_sheet(ws, [18, 22, 26, 52, 48], freeze="A4")

    r = title(ws, 1, "商材別 輸入時の必要情報", 5,
              "社内の一次スクリーニング用の目安。HSコードは税関の事前教示制度で、"
              "法令の適用は所管部署・専門家で確定させること。法的助言ではない。")
    r += 1
    r = header(ws, r, ["商材", "HSコード候補", "主な法令", "必要な手続・書類", "注意点"])

    for p in products["products"]:
        laws, reqs = [], []
        for reg in p.get("regulations", []):
            laws.append(reg["law"] + (f"（{reg['category']}）" if reg.get("category") else ""))
            reqs += [f"・{x}" for x in reg.get("required", [])]
            if reg.get("note"):
                reqs.append(f"　※{reg['note']}")
        cell(ws, r, 1, f"{p['name_ja']}\n{p['name_en']}", bold=True)
        cell(ws, r, 2, "\n".join(p["hs_candidates"]) + "\n\n" + p.get("hs_note", ""), size=9)
        cell(ws, r, 3, "\n".join(laws) if laws else "（特段の許認可なし）", size=9)
        cell(ws, r, 4, "\n".join(reqs) if reqs else "－", size=9)
        cell(ws, r, 5, p.get("notes", ""), size=9)
        ws.row_dimensions[r].height = max(60, 13 * max(len(reqs), 4))
        r += 1

    r += 1
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
    cell(ws, r, 1,
         "最も重いのはフェイスクレンザー。薬機法上の化粧品にあたり、"
         "化粧品製造販売業許可・製造業許可・品目ごとの届出・全成分の配合可否確認・薬監証明が"
         "発注より前に必要で、許可取得には数か月かかることがある。"
         "自社に許可があるか未定のまま代金を払うと、通関できない在庫を抱えることになる。",
         bold=True, fill=AMBER)
    ws.row_dimensions[r].height = 46
    return ws


def _ascii_path(path):
    """ファイル名がASCIIのみか。

    LANG未設定（POSIXロケール）の環境では、日本語のファイル名を外部コマンドに
    渡した時点で ? に化ける。LibreOffice はその存在しないファイルを開こうとして
    延々と待つので、原因が分かりにくい形で止まる。
    """
    try:
        str(path).encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def main():
    ap = argparse.ArgumentParser(description="送金チェック結果をExcelにまとめる")
    ap.add_argument("transaction")
    ap.add_argument("--pdf", help="申込書PDF（渡すと転記チェックのシートが埋まる）")
    ap.add_argument("-o", "--output", default="送金チェック.xlsx")
    args = ap.parse_args()

    with open(args.transaction, encoding="utf-8") as f:
        tx = json.load(f)

    products = vr.load_config("products.json")
    findings = vr.RemittanceVerifier(
        tx,
        vr.load_config("beneficiaries.json"),
        vr.load_config("bank_directory.json"),
        vr.load_config("risk_screening.json"),
        products,
    ).run()

    pdf_data = None
    if args.pdf:
        import extract_pdf
        pdf_data = extract_pdf.extract(args.pdf)

    wb = Workbook()
    wb.remove(wb.active)
    build_summary(wb, tx, findings)
    build_reconciliation(wb, tx, pdf_data)
    build_findings(wb, findings)
    build_checklist(wb, tx)
    build_products(wb, products)

    wb.save(args.output)
    print(f"作成: {args.output}")
    if not _ascii_path(args.output):
        print("  注意: ファイル名に非ASCII文字が含まれる。"
              "ロケールがPOSIXの環境では、LibreOffice等の外部コマンドに渡す際に"
              "ファイル名が化けて開けないことがある。"
              "recalc をかけるときは一度ASCII名にコピーすること。")
    print(f"  シート: {', '.join(wb.sheetnames)}")
    print(f"  指摘: 🔴{sum(1 for f in findings if f.severity == vr.BLOCK)}件"
          f" / 🟡{sum(1 for f in findings if f.severity == vr.WARN)}件"
          f" / 🔵{sum(1 for f in findings if f.severity == vr.INFO)}件")


if __name__ == "__main__":
    sys.exit(main())
