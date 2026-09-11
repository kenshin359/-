#!/usr/bin/env python3
# ============================================================
#  店舗責任者 業務マニュアル＆チェックリスト（Excel）の生成
# ------------------------------------------------------------
#  店舗を回す／スタッフを育てる／上司へ数字で報告する の3役割を、
#  そのまま印刷・配布して使える1冊のExcelにまとめます。
#
#  入力: config/store-manual.json（文面・チェック項目はすべてここ。
#        担当者や店舗が変わってもJSONを直すだけで作り直せます）
#  出力: out/店舗責任者_業務マニュアル_<担当者>さん.xlsx
#
#  実行:
#    npm run manual:store
#    python3 scripts/buildStoreManual.py --name=高山 --store=梅田店 --month=2026-09
#
#  ★合計・実施率・成約率などは Excel の数式で入れています。
#    現場が数字を直すと自動で計算し直されます（青字のセルは書き換え可）。
# ============================================================
import json
import os
import sys
from datetime import date, datetime
import calendar

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule, FormulaRule

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

F = 'Yu Gothic'
TITLE = Font(name=F, bold=True, size=15)
H2 = Font(name=F, bold=True, size=12)
HEAD = Font(name=F, bold=True, color='FFFFFF', size=10)
BODY = Font(name=F, size=10)
BOLD = Font(name=F, bold=True, size=10)
SMALL = Font(name=F, size=9, color='666666')
BLUE = Font(name=F, size=10, color='0000FF')
MONO = Font(name=F, size=10)
SAT = Font(name=F, size=9, color='0070C0')
SUN = Font(name=F, size=9, color='C00000')

NAVY = PatternFill('solid', fgColor='1F3864')
GRAY = PatternFill('solid', fgColor='F2F2F2')
BLOCK = PatternFill('solid', fgColor='DDEBF7')
LV = PatternFill('solid', fgColor='E2EFDA')
INPUT = PatternFill('solid', fgColor='FFF2CC')
TOTAL = PatternFill('solid', fgColor='D9E2F3')

thin = Side(style='thin', color='BFBFBF')
B = Border(left=thin, right=thin, top=thin, bottom=thin)

YEN = '¥#,##0;(¥#,##0);-'
NUM = '#,##0;(#,##0);-'
PCT = '0.0%'

WD = '月火水木金土日'
CHECK_DV = '"✓,ー"'
STATUS_DV = '"未着手,進行中,確認待ち,完了"'
LEVEL_DV = '"1,2,3,4"'


def arg(name, fallback=None):
    hit = next((a for a in sys.argv[1:] if a.startswith(f'--{name}=')), None)
    return hit.split('=', 1)[1] if hit else fallback


def head_row(ws, row, headers, widths=None):
    """見出し行（紺地・白文字）を引く。"""
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = HEAD
        c.fill = NAVY
        c.border = B
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w


def put(ws, row, col, value, font=BODY, fmt=None, wrap=False, fill=None, align=None):
    c = ws.cell(row=row, column=col, value=value)
    c.font = font
    c.border = B
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = fill
    c.alignment = Alignment(vertical='top' if wrap else 'center', wrap_text=wrap,
                            horizontal=align)
    return c


def note(ws, row, text, col=1):
    c = ws.cell(row=row, column=col, value=text)
    c.font = SMALL
    return c


# ------------------------------------------------------------
#  ① 使い方（表紙）
# ------------------------------------------------------------
def sheet_intro(wb, cfg, month, sheets):
    ws = wb.active
    ws.title = '使い方'
    ws.sheet_view.showGridLines = False
    ws['A1'] = '店舗責任者 業務マニュアル ＆ チェックリスト'
    ws['A1'].font = TITLE
    ws['A2'] = (f"{cfg['store']} ／ 担当: {cfg['person']}さん ／ 報告先: {cfg['report_to']}さん"
                f"（{cfg['channel']}） ／ 対象月: {month[:4]}年{int(month[5:7])}月")
    ws['A2'].font = BODY
    note(ws, 3, f'作成日: {date.today():%Y/%m/%d}　このファイルは config/store-manual.json から自動生成しています。')

    r = 5
    ws.cell(row=r, column=1, value='この仕事の3つの役割').font = H2
    r += 1
    head_row(ws, r, ['役割', 'できている状態'], [26, 62])
    for name, state in cfg['roles']:
        r += 1
        put(ws, r, 1, name, BOLD, fill=BLOCK)
        put(ws, r, 2, state, wrap=True)

    r += 2
    ws.cell(row=r, column=1, value='シートの使い分け').font = H2
    r += 1
    head_row(ws, r, ['シート', 'いつ使うか'])
    for name, when in sheets:
        r += 1
        put(ws, r, 1, name, BOLD)
        put(ws, r, 2, when, wrap=True)

    r += 2
    ws.cell(row=r, column=1, value='守ること').font = H2
    for i, rule in enumerate(cfg['rules'], 1):
        r += 1
        put(ws, r, 1, f'{i}', BOLD, align='center')
        put(ws, r, 2, rule, wrap=True)

    r += 2
    note(ws, r, '■ 青字のセルは現場で書き換えてよい欄です。白地の数式セル（実施率・合計・達成率）は自動計算します。')
    note(ws, r + 1, '■ チェック欄は ✓（実施）と ー（実施せず）の2つだけ。空欄は「まだ記入していない」扱いで分母に入りません。')
    ws.column_dimensions['A'].width = 26
    ws.column_dimensions['B'].width = 78
    return ws


# ------------------------------------------------------------
#  ② 日次チェック（1か月ぶんの実施記録）
# ------------------------------------------------------------
def sheet_daily(wb, cfg, y, m):
    ws = wb.create_sheet('日次チェック')
    ndays = calendar.monthrange(y, m)[1]
    ws['A1'] = f'日次チェック（{y}年{m}月）'
    ws['A1'].font = TITLE
    note(ws, 2, '毎日、終わった業務に ✓ を入れる。やらなかった日は ー。実施率は自動計算（分母は記入済みの日数）。')

    HROW = 4
    DAY0 = 8  # H列から日付
    head_row(ws, HROW, ['時間帯', '業務', '完了の定義（数字で。「やった」は完了ではない）', '目安', '実施', '未実施', '実施率'],
             [9, 34, 44, 6, 6, 7, 8])
    for d in range(1, ndays + 1):
        col = DAY0 + d - 1
        c = ws.cell(row=HROW, column=col, value=d)
        c.font = HEAD
        c.fill = NAVY
        c.border = B
        c.alignment = Alignment(horizontal='center')
        wd = WD[date(y, m, d).weekday()]
        c2 = ws.cell(row=HROW + 1, column=col, value=wd)
        c2.font = SUN if wd == '日' else (SAT if wd == '土' else SMALL)
        c2.border = B
        c2.alignment = Alignment(horizontal='center')
        ws.column_dimensions[get_column_letter(col)].width = 3.6
    for i, label in enumerate(['', '', '', '', '', '', '曜日'], 1):
        c = ws.cell(row=HROW + 1, column=i, value=label)
        c.font = SMALL
        c.border = B
        c.alignment = Alignment(horizontal='center')

    first = HROW + 2
    r = first - 1
    prev_block = None
    for block, task, done, mins in cfg['daily']:
        r += 1
        put(ws, r, 1, block if block != prev_block else '', BOLD, fill=BLOCK, align='center')
        prev_block = block
        put(ws, r, 2, task, wrap=True)
        put(ws, r, 3, done, wrap=True)
        put(ws, r, 4, (f'{mins}分' if mins else '随時'), SMALL, align='center')
        last = get_column_letter(DAY0 + ndays - 1)
        put(ws, r, 5, f'=COUNTIF(H{r}:{last}{r},"✓")', BODY, NUM, align='center')
        put(ws, r, 6, f'=COUNTIF(H{r}:{last}{r},"ー")', BODY, NUM, align='center')
        put(ws, r, 7, f'=IF(E{r}+F{r}=0,"",E{r}/(E{r}+F{r}))', BODY, PCT, align='center')
        for d in range(1, ndays + 1):
            c = ws.cell(row=r, column=DAY0 + d - 1)
            c.border = B
            c.font = BLUE
            c.alignment = Alignment(horizontal='center')
        ws.row_dimensions[r].height = 30
    lastrow = r

    r += 1
    put(ws, r, 2, '当日の実施数', BOLD, fill=TOTAL)
    for cc in (1, 3, 4, 5, 6, 7):
        put(ws, r, cc, None, BOLD, fill=TOTAL)
    for d in range(1, ndays + 1):
        col = get_column_letter(DAY0 + d - 1)
        put(ws, r, DAY0 + d - 1, f'=COUNTIF({col}{first}:{col}{lastrow},"✓")', BOLD, NUM,
            fill=TOTAL, align='center')

    dv = DataValidation(type='list', formula1=CHECK_DV, allow_blank=True, showErrorMessage=True,
                        error='✓ か ー を選んでください', errorTitle='入力できる値')
    ws.add_data_validation(dv)
    dv.add(f'H{first}:{get_column_letter(DAY0 + ndays - 1)}{lastrow}')

    # 実施率が9割を下回ったら赤。責任者が翌週ここだけ見れば穴が分かる。
    ws.conditional_formatting.add(
        f'G{first}:G{lastrow}',
        CellIsRule(operator='lessThan', formula=['0.9'],
                   fill=PatternFill('solid', bgColor='FFC7CE'), font=Font(color='9C0006')))
    ws.freeze_panes = f'H{first}'
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return ws


# ------------------------------------------------------------
#  ③ 週次チェック
# ------------------------------------------------------------
def sheet_weekly(wb, cfg):
    ws = wb.create_sheet('週次チェック')
    ws['A1'] = '週次チェック'
    ws['A1'].font = TITLE
    note(ws, 2, '週ごとに ✓／ー を入れる。第5週は無い月もあるので空欄のままでよい（分母に入りません）。')
    HROW = 4
    head_row(ws, HROW, ['業務', '完了の定義（数字で）', 'いつ', '第1週', '第2週', '第3週', '第4週', '第5週', '実施率'],
             [34, 46, 14, 8, 8, 8, 8, 8, 9])
    first = HROW + 1
    r = HROW
    for task, done, when in cfg['weekly']:
        r += 1
        put(ws, r, 1, task, wrap=True)
        put(ws, r, 2, done, wrap=True)
        put(ws, r, 3, when, SMALL, align='center')
        for cc in range(4, 9):
            c = put(ws, r, cc, None, BLUE, align='center')
        put(ws, r, 9, f'=IF(COUNTIF(D{r}:H{r},"✓")+COUNTIF(D{r}:H{r},"ー")=0,"",'
                      f'COUNTIF(D{r}:H{r},"✓")/(COUNTIF(D{r}:H{r},"✓")+COUNTIF(D{r}:H{r},"ー")))',
            BODY, PCT, align='center')
        ws.row_dimensions[r].height = 30
    last = r
    dv = DataValidation(type='list', formula1=CHECK_DV, allow_blank=True, showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add(f'D{first}:H{last}')
    ws.conditional_formatting.add(
        f'I{first}:I{last}',
        CellIsRule(operator='lessThan', formula=['0.9'],
                   fill=PatternFill('solid', bgColor='FFC7CE'), font=Font(color='9C0006')))
    ws.freeze_panes = f'A{first}'
    return ws


# ------------------------------------------------------------
#  ④ 月次チェック
# ------------------------------------------------------------
def sheet_monthly(wb, cfg, month):
    ws = wb.create_sheet('月次チェック')
    ws['A1'] = f'月次チェック（{month[:4]}年{int(month[5:7])}月）'
    ws['A1'].font = TITLE
    note(ws, 2, '期限の早い順に並んでいます。状態は毎朝ここだけ更新すればよい（未着手／進行中／確認待ち／完了）。')
    HROW = 4
    head_row(ws, HROW, ['業務', '完了の定義（数字で）', '期限', '状態', '実施日', 'メモ'],
             [34, 46, 12, 11, 12, 30])
    first = HROW + 1
    r = HROW
    for task, done, due in cfg['monthly']:
        r += 1
        put(ws, r, 1, task, wrap=True)
        put(ws, r, 2, done, wrap=True)
        put(ws, r, 3, due, SMALL, align='center')
        put(ws, r, 4, '未着手', BLUE, align='center')
        put(ws, r, 5, None, BLUE, align='center')
        put(ws, r, 6, None, BLUE, wrap=True)
        ws.row_dimensions[r].height = 30
    last = r
    r += 1
    put(ws, r, 1, '完了率', BOLD, fill=TOTAL)
    put(ws, r, 2, None, BOLD, fill=TOTAL)
    put(ws, r, 3, None, BOLD, fill=TOTAL)
    put(ws, r, 4, f'=COUNTIF(D{first}:D{last},"完了")/{last - first + 1}', BOLD, PCT,
        fill=TOTAL, align='center')
    put(ws, r, 5, None, BOLD, fill=TOTAL)
    put(ws, r, 6, None, BOLD, fill=TOTAL)

    dv = DataValidation(type='list', formula1=STATUS_DV, allow_blank=True, showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add(f'D{first}:D{last}')
    ws.conditional_formatting.add(
        f'D{first}:D{last}',
        FormulaRule(formula=[f'$D{first}="完了"'],
                    fill=PatternFill('solid', bgColor='C6EFCE'), font=Font(color='006100')))
    ws.freeze_panes = f'A{first}'
    return ws


# ------------------------------------------------------------
#  ⑤ 教育カリキュラム（＋新人30日プラン）
# ------------------------------------------------------------
def sheet_curriculum(wb, cfg):
    ws = wb.create_sheet('教育カリキュラム')
    ws['A1'] = 'スタッフ教育カリキュラム（4段階）'
    ws['A1'].font = TITLE
    note(ws, 2, '「できるようになった」の判定は必ず数字で行う。到達基準を満たしたら習得状況シートのレベルを上げる。')
    HROW = 4
    head_row(ws, HROW, ['段階', '習得項目', '到達基準（数字で）', '標準日数', '確認方法'],
             [22, 30, 42, 9, 24])
    r = HROW
    prev = None
    for level, item, standard, days, how in cfg['curriculum']:
        r += 1
        put(ws, r, 1, level if level != prev else '', BOLD, fill=LV)
        prev = level
        put(ws, r, 2, item, wrap=True)
        put(ws, r, 3, standard, wrap=True)
        put(ws, r, 4, f'{days}日', SMALL, align='center')
        put(ws, r, 5, how, SMALL, wrap=True)
        ws.row_dimensions[r].height = 28

    r += 2
    ws.cell(row=r, column=1, value='新人の30日プラン（Lv2到達までの型）').font = H2
    r += 1
    head_row(ws, r, ['期間', 'やること', 'この期間の到達基準'])
    for period, doing, goal in cfg['onboarding']:
        r += 1
        put(ws, r, 1, period, BOLD, fill=BLOCK, align='center')
        put(ws, r, 2, doing, wrap=True)
        put(ws, r, 3, goal, wrap=True)
        ws.row_dimensions[r].height = 28
    r += 2
    note(ws, r, '30日でLv2に届かない場合は、本人ではなく教育計画を作り直す（「判断基準」シート参照）。')
    ws.freeze_panes = f'A{HROW + 1}'
    return ws


# ------------------------------------------------------------
#  ⑥ 習得状況（スタッフ別マトリクス）
# ------------------------------------------------------------
def sheet_skills(wb, cfg):
    ws = wb.create_sheet('習得状況')
    skills = cfg['skills']
    ws['A1'] = 'スタッフ別 習得状況'
    ws['A1'].font = TITLE
    note(ws, 2, '1=見習い（見学のみ）／2=補助付きでできる／3=単独でできる／4=人に教えられる。1on1のたびに更新する。')

    HROW = 4
    n = len(skills)
    headers = ['スタッフ', '入社日'] + skills + ['平均', '判定']
    head_row(ws, HROW, headers)
    ws.column_dimensions['A'].width = 14
    ws.column_dimensions['B'].width = 12
    for i in range(n):
        col = get_column_letter(3 + i)
        ws.column_dimensions[col].width = 5.4
        ws.cell(row=HROW, column=3 + i).alignment = Alignment(
            horizontal='center', vertical='bottom', wrap_text=True, text_rotation=90)
    ws.row_dimensions[HROW].height = 92
    avg_col = 3 + n
    jdg_col = avg_col + 1
    ws.column_dimensions[get_column_letter(avg_col)].width = 7
    ws.column_dimensions[get_column_letter(jdg_col)].width = 18

    first = HROW + 1
    ROWS = 10  # 空行。スタッフが増えても行を挿入すれば数式はコピーで足りる
    for i in range(ROWS):
        r = first + i
        put(ws, r, 1, None, BLUE)
        put(ws, r, 2, None, BLUE, 'yyyy/m/d', align='center')
        for j in range(n):
            put(ws, r, 3 + j, None, BLUE, align='center')
        a = get_column_letter(3)
        z = get_column_letter(2 + n)
        put(ws, r, avg_col, f'=IF(COUNT({a}{r}:{z}{r})=0,"",ROUND(AVERAGE({a}{r}:{z}{r}),1))',
            BODY, '0.0', align='center')
        av = get_column_letter(avg_col)
        put(ws, r, jdg_col,
            f'=IF({av}{r}="","",IF({av}{r}>=3.5,"Lv4 人に教えられる",'
            f'IF({av}{r}>=3,"Lv3 単独でできる",IF({av}{r}>=2,"Lv2 補助付き","Lv1 見習い"))))',
            BODY, align='center')
    last = first + ROWS - 1

    dv = DataValidation(type='list', formula1=LEVEL_DV, allow_blank=True, showErrorMessage=True,
                        error='1〜4で入力してください', errorTitle='習得レベル')
    ws.add_data_validation(dv)
    dv.add(f'C{first}:{get_column_letter(2 + n)}{last}')
    # 低いほど赤、高いほど緑。穴のある項目が縦に見える。
    ws.conditional_formatting.add(
        f'C{first}:{get_column_letter(2 + n)}{last}',
        ColorScaleRule(start_type='num', start_value=1, start_color='F8CBAD',
                       mid_type='num', mid_value=2.5, mid_color='FFE699',
                       end_type='num', end_value=4, end_color='C6EFCE'))

    r = last + 1
    put(ws, r, 1, '項目平均', BOLD, fill=TOTAL)
    put(ws, r, 2, None, BOLD, fill=TOTAL)
    for j in range(n):
        col = get_column_letter(3 + j)
        put(ws, r, 3 + j, f'=IF(COUNT({col}{first}:{col}{last})=0,"",'
                          f'ROUND(AVERAGE({col}{first}:{col}{last}),1))',
            BOLD, '0.0', fill=TOTAL, align='center')
    put(ws, r, avg_col, None, BOLD, fill=TOTAL)
    put(ws, r, jdg_col, '← 数字が低い列が店の弱点', SMALL, fill=TOTAL)

    r += 2
    ws.cell(row=r, column=1, value='レベルの意味').font = H2
    for lv, meaning in cfg['skill_levels']:
        r += 1
        put(ws, r, 1, lv, BOLD, align='center')
        put(ws, r, 2, meaning, BODY)
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=6)
    ws.freeze_panes = f'C{first}'
    return ws


# ------------------------------------------------------------
#  ⑦ KPI記録（日別・上司報告の数字はここから取る）
# ------------------------------------------------------------
def sheet_kpi(wb, cfg, y, m):
    ws = wb.create_sheet('KPI記録')
    ndays = calendar.monthrange(y, m)[1]
    labels = cfg['kpi']['labels']
    t = cfg['kpi']['targets']
    ws['A1'] = f'KPI記録（{y}年{m}月）'
    ws['A1'].font = TITLE
    note(ws, 2, '毎日、閉店後に黄色い欄へ入力する。率・客単価・達成率・必要日販は自動計算。日報／週報／月報の数字はこのシートから取る。')

    # --- 目標ブロック（黄色＝入力欄） ---
    ws['A4'] = '月間目標'
    ws['A4'].font = H2
    rows = [('売上目標（円）', t.get('sales', 0), YEN),
            ('成約目標（件）', t.get('deals', 0), NUM),
            ('営業日数（日）', t.get('workdays', 26), NUM),
            ('残り営業日（日）', 0, NUM)]
    for i, (label, val, fmt) in enumerate(rows):
        r = 5 + i
        put(ws, r, 1, label, BOLD)
        put(ws, r, 2, val, BLUE, fmt, fill=INPUT, align='center')

    HROW = 10
    heads = ['日付', '曜日', labels[0], labels[1], labels[2], '成約率', labels[3], '客単価',
             labels[4], labels[5], 'メモ']
    head_row(ws, HROW, heads, [8, 6, 9, 12, 9, 9, 13, 12, 12, 12, 30])
    first = HROW + 1
    for d in range(1, ndays + 1):
        r = first + d - 1
        wd = WD[date(y, m, d).weekday()]
        put(ws, r, 1, f'{m}/{d}', BODY, align='center')
        put(ws, r, 2, wd, SUN if wd == '日' else (SAT if wd == '土' else SMALL), align='center')
        for cc in (3, 4, 5, 7, 9, 10):
            put(ws, r, cc, None, BLUE, YEN if cc == 7 else NUM, fill=INPUT, align='center')
        put(ws, r, 6, f'=IF(N(D{r})=0,"",E{r}/D{r})', BODY, PCT, align='center')
        put(ws, r, 8, f'=IF(N(E{r})=0,"",G{r}/E{r})', BODY, YEN, align='center')
        put(ws, r, 11, None, BLUE, wrap=True)
    last = first + ndays - 1

    r = last + 1
    put(ws, r, 1, '合計', BOLD, fill=TOTAL)
    put(ws, r, 2, None, BOLD, fill=TOTAL)
    for cc, letter in [(3, 'C'), (4, 'D'), (5, 'E'), (7, 'G'), (9, 'I')]:
        put(ws, r, cc, f'=SUM({letter}{first}:{letter}{last})', BOLD,
            YEN if cc == 7 else NUM, fill=TOTAL, align='center')
    put(ws, r, 6, f'=IF(N(D{r})=0,"",E{r}/D{r})', BOLD, PCT, fill=TOTAL, align='center')
    put(ws, r, 8, f'=IF(N(E{r})=0,"",G{r}/E{r})', BOLD, YEN, fill=TOTAL, align='center')
    put(ws, r, 10, f'=IF(COUNT(J{first}:J{last})=0,"",ROUND(AVERAGE(J{first}:J{last}),1))',
        BOLD, '0.0', fill=TOTAL, align='center')
    put(ws, r, 11, '← 稼働数は平均', SMALL, fill=TOTAL)
    total = r

    r += 1
    put(ws, r, 1, '達成率', BOLD, fill=GRAY)
    put(ws, r, 2, None, BOLD, fill=GRAY)
    put(ws, r, 3, None, BOLD, fill=GRAY)
    put(ws, r, 4, None, BOLD, fill=GRAY)
    put(ws, r, 5, f'=IF(N($B$6)=0,"",E{total}/$B$6)', BOLD, PCT, fill=GRAY, align='center')
    put(ws, r, 6, None, BOLD, fill=GRAY)
    put(ws, r, 7, f'=IF(N($B$5)=0,"",G{total}/$B$5)', BOLD, PCT, fill=GRAY, align='center')
    for cc in (8, 9, 10, 11):
        put(ws, r, cc, None, BOLD, fill=GRAY)
    rate = r

    r += 1
    put(ws, r, 1, '残りの必要日販', BOLD, fill=GRAY)
    put(ws, r, 2, None, BOLD, fill=GRAY)
    put(ws, r, 3, None, BOLD, fill=GRAY)
    put(ws, r, 4, None, BOLD, fill=GRAY)
    put(ws, r, 5, f'=IF(N($B$8)=0,"",ROUNDUP(MAX($B$6-E{total},0)/$B$8,0))', BOLD, NUM,
        fill=GRAY, align='center')
    put(ws, r, 6, None, BOLD, fill=GRAY)
    put(ws, r, 7, f'=IF(N($B$8)=0,"",ROUNDUP(MAX($B$5-G{total},0)/$B$8,0))', BOLD, YEN,
        fill=GRAY, align='center')
    put(ws, r, 8, '← 残り営業日（B8）で割った、1日あたりの必要数', SMALL, fill=GRAY)
    for cc in (9, 10, 11):
        put(ws, r, cc, None, BOLD, fill=GRAY)

    ws.conditional_formatting.add(f'G{first}:G{last}',
                                  DataBarRule(start_type='num', start_value=0,
                                              end_type='max', color='638EC6'))
    ws.conditional_formatting.add(
        f'F{first}:F{last}',
        CellIsRule(operator='lessThan', formula=[f'$F${total}'],
                   fill=PatternFill('solid', bgColor='FFF2CC')))
    ws.freeze_panes = f'C{first}'
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return ws


# ------------------------------------------------------------
#  ⑧ 上司報告（ルール＋そのまま貼れる定型文）
# ------------------------------------------------------------
def sheet_report(wb, cfg):
    ws = wb.create_sheet('上司報告')
    ws.sheet_view.showGridLines = False
    ws['A1'] = f"上司報告のルールと定型文（報告先: {cfg['report_to']}さん・{cfg['channel']}）"
    ws['A1'].font = TITLE
    note(ws, 2, '数字が先、感想はあと。数字を出せない日は「出せなかった理由」を書く。')

    r = 4
    head_row(ws, r, ['種類', 'いつまでに', '書く内容', '注意'], [12, 24, 50, 34])
    for kind, when, what, care in cfg['reports']:
        r += 1
        put(ws, r, 1, kind, BOLD, fill=BLOCK, align='center')
        put(ws, r, 2, when, BODY, wrap=True)
        put(ws, r, 3, what, BODY, wrap=True)
        put(ws, r, 4, care, SMALL, wrap=True)
        ws.row_dimensions[r].height = 32

    r += 2
    ws.cell(row=r, column=1, value='「緊急報告」に当てはまるもの（30分以内・時間帯を問わない）').font = H2
    for case in cfg['urgent_cases']:
        r += 1
        put(ws, r, 1, '・', BODY, align='center')
        put(ws, r, 2, case, BODY, wrap=True)
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)

    r += 2
    ws.cell(row=r, column=1, value='そのまま貼って使う定型文（数字の桁だけ差し替える）').font = H2
    for title, body in cfg['templates'].items():
        r += 1
        c = put(ws, r, 1, title, BOLD, fill=NAVY)
        c.font = HEAD
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
        r += 1
        put(ws, r, 1, body, MONO, wrap=True)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
        ws.row_dimensions[r].height = 16 * (body.count('\n') + 2)
        r += 1
    return ws


# ------------------------------------------------------------
#  ⑨ 判断基準（迷ったらここを見る）
# ------------------------------------------------------------
def sheet_rules(wb, cfg):
    ws = wb.create_sheet('判断基準')
    ws['A1'] = '判断基準・エスカレーション（迷ったら自分で決めずにここを見る）'
    ws['A1'].font = TITLE
    note(ws, 2, 'しきい値はすべて数字。基準に触れたら、判断を待たずに決められた相手へ上げる。')
    r = 4
    head_row(ws, r, ['事象', 'しきい値（数字）', '誰が判断', 'いつまでに', '打ち手'],
             [22, 26, 14, 26, 44])
    for case, threshold, who, when, action in cfg['escalation']:
        r += 1
        put(ws, r, 1, case, BOLD, fill=BLOCK, wrap=True)
        put(ws, r, 2, threshold, BODY, wrap=True)
        put(ws, r, 3, who, BODY, align='center')
        put(ws, r, 4, when, BODY, wrap=True)
        put(ws, r, 5, action, BODY, wrap=True)
        ws.row_dimensions[r].height = 32
    r += 2
    note(ws, r, '■ 基準に無い事象が起きたら「自分で約束せず、事実だけを30分以内に報告」が既定の動き。')
    note(ws, r + 1, '■ この表は月次チェックの「業務マニュアルの見直し」で毎月1件以上直す。')
    ws.freeze_panes = 'A5'
    return ws


def main():
    cfg_path = arg('config', os.path.join(ROOT, 'config', 'store-manual.json'))
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    cfg['person'] = arg('name', cfg['person'])
    cfg['store'] = arg('store', cfg['store'])
    cfg['report_to'] = arg('to', cfg['report_to'])
    month = arg('month', f'{date.today():%Y-%m}')
    try:
        y, m = map(int, month.split('-'))
        datetime(y, m, 1)
    except ValueError:
        sys.exit(f'--month は YYYY-MM で指定してください（受け取った値: {month}）')

    sheets = [
        ('日次チェック', '毎日。開店前・営業中・閉店後の3ブロック。終わったら ✓。'),
        ('週次チェック', '週1回（主に月曜と金曜）。数値のふり返りと1on1、棚卸と安全点検。'),
        ('月次チェック', '月1回。目標合意・シフト・発注・月報・育成計画の更新。'),
        ('教育カリキュラム', 'スタッフを採ったとき／レベルを上げるとき。到達基準は数字。'),
        ('習得状況', '1on1のあと。スタッフ別に1〜4で記入。低い列が店の弱点。'),
        ('KPI記録', '毎日、閉店後。報告に使う数字はすべてここから取る。'),
        ('上司報告', '日報・週報・月報・緊急報告を書くとき。定型文をコピーする。'),
        ('判断基準', '迷ったとき。しきい値に触れたら自分で決めずに上げる。'),
    ]

    wb = Workbook()
    sheet_intro(wb, cfg, month, sheets)
    sheet_daily(wb, cfg, y, m)
    sheet_weekly(wb, cfg)
    sheet_monthly(wb, cfg, month)
    sheet_curriculum(wb, cfg)
    sheet_skills(wb, cfg)
    sheet_kpi(wb, cfg, y, m)
    sheet_report(wb, cfg)
    sheet_rules(wb, cfg)

    out = arg('out', os.path.join(ROOT, 'out',
                                  f"店舗責任者_業務マニュアル_{cfg['person']}さん.xlsx"))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wb.save(out)
    print(f'できました: {out}')
    print(f"  担当: {cfg['person']}さん ／ 店舗: {cfg['store']} ／ 対象月: {month}")
    print(f"  シート: {' / '.join(ws.title for ws in wb.worksheets)}")
    print('  文面・チェック項目を直すときは config/store-manual.json を編集して作り直してください。')


if __name__ == '__main__':
    main()
