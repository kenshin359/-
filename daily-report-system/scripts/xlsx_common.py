#!/usr/bin/env python3
# ============================================================
#  Excel（.xlsx）の印刷設定の共通部品
# ------------------------------------------------------------
#  PDFに変換したときに、
#   ・表が横で切れない（幅を1ページに合わせる）
#   ・2ページ目以降にも見出し行が出る
#   ・用紙と向きが揃う
#  ようにするための設定です。openpyxl の既定は「設定なし」なので、
#  これを入れないと変換したPDFの改ページがばらばらになります。
# ============================================================


def setup_print(ws, landscape=False, one_page=False, title_rows=None,
                margins=(0.4, 0.5), centered=False, area=None):
    """
    ws           : 対象シート
    landscape    : 横向きにするなら True
    one_page     : 縦も1ページに収めるなら True（行数の少ないシートだけに使う）
    title_rows   : 繰り返す見出し行（例 '4:5'）。2ページ以降にも出る
    margins      : (左右, 上下) インチ
    centered     : 用紙の左右中央に置く（申込書などの用紙向き）
    area         : 印刷範囲（例 'A1:H60'）
    """
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = 'landscape' if landscape else 'portrait'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1 if one_page else 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    lr, tb = margins
    ws.page_margins.left = ws.page_margins.right = lr
    ws.page_margins.top = ws.page_margins.bottom = tb
    ws.page_margins.header = ws.page_margins.footer = 0.2
    if title_rows:
        ws.print_title_rows = title_rows
    if centered:
        ws.print_options.horizontalCentered = True
    if area:
        ws.print_area = area
    return ws
