#!/usr/bin/env python3
# ============================================================
#  合算CPAシートの組み立て（合言葉「大怪獣ワチソンCPA」用）
# ------------------------------------------------------------
#  入力: cpa_inputs.json（キントーンから取得・復号済みのデータ。
#        リポジトリには含めない。実行環境のローカルにのみ置く）
#    {"month": "2026-08",
#     "units": {"1": {"amazon": 29, "rakuten": 49, "own": 16}, ...},
#     "ad": {"trav": {"1": 240512, ...}, "cat": {...}, "az": {...},
#            "rpp": {...}, "google": {...}}}
#  出力: 合算CPA_<month>.xlsx
#    - サマリー（判定前提・月間平均CPA・判定内訳）
#    - 日次（媒体別広告費・スーツケース個数・合算CPA・判定・7日移動）
#  判定基準: 客単価30,000円 × 目標広告比率15% / 許容20%
#            → 目標CPA 4,500円(🟢) / 許容CPA 6,000円(🟡) / 超過(🔴)
#  実行: python3 scripts/buildCpaSheet.py cpa_inputs.json [出力パス]
# ============================================================
import json
import sys
import calendar
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.utils import get_column_letter

UNIT_PRICE = 30000
TARGET_RATE = 0.15
ALLOW_RATE = 0.20

F = 'Yu Gothic'
NUM = '#,##0'
YEN = '¥#,##0;(¥#,##0);-'


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'cpa_inputs.json'
    data = json.load(open(src, encoding='utf-8'))
    month = data['month']
    units = {int(k): v for k, v in data['units'].items()}
    ad = {m: {int(k): v for k, v in days.items()} for m, days in data['ad'].items()}
    y, m = map(int, month.split('-'))
    ndays = calendar.monthrange(y, m)[1]
    last = max(units.keys()) if units else 0
    out = sys.argv[2] if len(sys.argv) > 2 else f'合算CPA_{month}.xlsx'

    hdrfill = PatternFill('solid', fgColor='1F3864')
    hdrfont = Font(name=F, bold=True, color='FFFFFF')
    bold = Font(name=F, bold=True)
    norm = Font(name=F)
    blue = Font(name=F, color='0000FF')
    gray = Font(name=F, size=9, color='808080')
    sumfill = PatternFill('solid', fgColor='E2EFDA')
    thin = Border(*[Side(style='thin', color='BFBFBF')] * 4)

    wb = Workbook()

    # ---------- 日次 ----------
    ws = wb.create_sheet('日次')
    heads = ['日付', 'メタ', 'Amazon広告', 'RPP', 'Google', 'その他',
             '合算広告費', 'Amazon個数', '楽天個数', '自社個数', '合計個数',
             '合算CPA', '判定', '7日移動CPA']
    widths = [7, 11, 11, 10, 9, 8, 12, 11, 9, 9, 9, 10, 6, 12]
    for c, (h, w) in enumerate(zip(heads, widths), 1):
        cell = ws.cell(1, c, h)
        cell.font = hdrfont
        cell.fill = hdrfill
        cell.border = thin
        cell.alignment = Alignment(horizontal='center')
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = 'A2'
    for day in range(1, ndays + 1):
        r = day + 1
        ws.cell(r, 1, f'{m}/{day}').font = norm
        if day <= last:
            meta = ad.get('trav', {}).get(day, 0) + ad.get('cat', {}).get(day, 0)
            vals = {2: meta, 3: ad.get('az', {}).get(day), 4: ad.get('rpp', {}).get(day, 0),
                    5: ad.get('google', {}).get(day, 0),
                    8: units[day]['amazon'], 9: units[day]['rakuten'], 10: units[day]['own']}
            for c, v in vals.items():
                if v is None:
                    continue
                cell = ws.cell(r, c, v)
                cell.font = blue
                cell.number_format = NUM
        ws.cell(r, 7, f'=IF(COUNT(B{r}:F{r})=0,"",SUM(B{r}:F{r}))').number_format = YEN
        ws.cell(r, 11, f'=IF(COUNT(H{r}:J{r})=0,"",SUM(H{r}:J{r}))').number_format = NUM
        ws.cell(r, 12, f'=IFERROR(G{r}/K{r},"")').number_format = YEN
        ws.cell(r, 13,
                f'=IF(L{r}="","",IF(L{r}<=サマリー!$B$7,"🟢",IF(L{r}<=サマリー!$B$8,"🟡","🔴")))')
        top = max(2, r - 6)
        ws.cell(r, 14, f'=IFERROR(SUM(G{top}:G{r})/SUM(K{top}:K{r}),"")').number_format = YEN
        for c in range(1, 15):
            ws.cell(r, c).border = thin
    r = ndays + 2
    ws.cell(r, 1, '合計').font = bold
    for c in list(range(2, 12)):
        letter = get_column_letter(c)
        cell = ws.cell(r, c, f'=SUM({letter}2:{letter}{ndays + 1})')
        cell.font = bold
        cell.fill = sumfill
        cell.number_format = YEN if c <= 7 else NUM
        cell.border = thin
    cell = ws.cell(r, 12, f'=IFERROR(G{r}/K{r},"")')
    cell.font = bold
    cell.fill = sumfill
    cell.number_format = YEN
    cell.border = thin
    ws.cell(r + 2, 1, '※メタ=トラベル+カタログ（リベティ分）。個数=売上明細のスーツケース系'
                      '（S/M/L・クラシックアルミ・多機能アルミ・アルミ型式未確認）。'
                      'TDA・TikTok・ガジェティ等の月次手動値は未計上。').font = gray

    # ---------- サマリー ----------
    ws0 = wb.active
    ws0.title = 'サマリー'
    ws0.column_dimensions['A'].width = 32
    ws0.column_dimensions['B'].width = 16
    ws0.column_dimensions['C'].width = 46
    t = ws0.cell(1, 1, f'Libetee 合算CPA（{month}・{m}/1〜{m}/{last}実績）')
    t.font = Font(name=F, bold=True, size=14)
    ws0.cell(2, 1, '広告費（メタ+Amazon+RPP+Google）÷ スーツケース販売個数（全チャネル）').font = gray
    rows = [
        ('想定客単価（税込・全チャネル平均）', UNIT_PRICE, '手入力の前提値'),
        ('目標 広告比率', TARGET_RATE, ''),
        ('許容 広告比率', ALLOW_RATE, ''),
        ('→ 目標CPA（🟢ライン）', '=B4*B5', ''),
        ('→ 許容CPA（🟡ライン）', '=B4*B6', 'これを超えたら🔴'),
        ('合算広告費 累計', f'=日次!G{ndays + 2}', ''),
        ('スーツケース販売個数 累計', f'=日次!K{ndays + 2}', ''),
        ('月間平均の合算CPA', '=B9/B10', ''),
        ('判定', '=IF(B11<=B7,"🟢",IF(B11<=B8,"🟡","🔴"))', ''),
        ('🟢の日数', f'=COUNTIF(日次!M2:M{ndays + 1},"🟢")', ''),
        ('🟡の日数', f'=COUNTIF(日次!M2:M{ndays + 1},"🟡")', ''),
        ('🔴の日数', f'=COUNTIF(日次!M2:M{ndays + 1},"🔴")', ''),
    ]
    for i, (label, val, note) in enumerate(rows):
        r = 4 + i
        ws0.cell(r, 1, label).font = bold if 'CPA' in label or '判定' in label else norm
        cell = ws0.cell(r, 2, val)
        cell.font = blue if isinstance(val, (int, float)) else norm
        cell.number_format = '0.0%' if '比率' in label else (NUM if '日数' in label or '個数' in label else YEN)
        ws0.cell(r, 3, note).font = gray
        for c in (1, 2, 3):
            ws0.cell(r, c).border = thin
    ws0.cell(17, 1, '※青字＝手入力の前提値・転記データ。それ以外は数式').font = gray

    wb.save(out)
    print(f'saved {out}')


if __name__ == '__main__':
    main()
