#!/usr/bin/env python3
# ============================================================
#  シフト表（Excel）の生成
# ------------------------------------------------------------
#  記号（早番A・中番B・遅番C…）を入れるだけで、出勤日数・労働時間・
#  人件費の目安・週40時間超え・人数不足・開店／閉店の穴が自動で出ます。
#
#  入力: config/shift.json（記号・必要人数・スタッフはここ）
#  出力: out/シフト表_<店舗>_<YYYY-MM>.xlsx
#    ① シフト表（月間）   ② シフト記号（凡例・ここを直せば時間が変わる）
#    ③ 希望シフト（スタッフに配る）   ④ 集計・労務チェック
#
#  実行:
#    npm run shift
#    python3 scripts/buildShiftSheet.py --month=2026-10 --store=梅田店
# ============================================================
import calendar
import json
import os
import sys
from datetime import date, datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule, FormulaRule

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

F = 'Yu Gothic'
TITLE = Font(name=F, bold=True, size=15)
H2 = Font(name=F, bold=True, size=12)
HEAD = Font(name=F, bold=True, color='FFFFFF', size=10)
BODY = Font(name=F, size=10)
BOLD = Font(name=F, bold=True, size=10)
SMALL = Font(name=F, size=9, color='666666')
BLUE = Font(name=F, size=10, color='0000FF')
SAT = Font(name=F, size=9, color='0070C0')
SUN = Font(name=F, size=9, color='C00000')
RED = Font(name=F, bold=True, size=10, color='C00000')

NAVY = PatternFill('solid', fgColor='1F3864')
GRAY = PatternFill('solid', fgColor='F2F2F2')
INPUT = PatternFill('solid', fgColor='FFF2CC')
TOTAL = PatternFill('solid', fgColor='D9E2F3')
WEEKEND = PatternFill('solid', fgColor='FCE4E4')

thin = Side(style='thin', color='BFBFBF')
B = Border(left=thin, right=thin, top=thin, bottom=thin)

NUM = '#,##0;(#,##0);-'
YEN = '¥#,##0;(¥#,##0);-'
HOUR = '0.0'
PCT = '0.0%'
WD = '月火水木金土日'

SHEET_SHIFT = 'シフト表'
SHEET_SYM = 'シフト記号'


def arg(name, fallback=None):
    hit = next((a for a in sys.argv[1:] if a.startswith(f'--{name}=')), None)
    return hit.split('=', 1)[1] if hit else fallback


def put(ws, row, col, value, font=BODY, fmt=None, fill=None, align=None, wrap=False):
    c = ws.cell(row=row, column=col, value=value)
    c.font = font
    c.border = B
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = fill
    c.alignment = Alignment(horizontal=align, vertical='top' if wrap else 'center',
                            wrap_text=wrap)
    return c


def head_row(ws, row, headers, widths=None):
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = HEAD
        c.fill = NAVY
        c.border = B
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w


def note(ws, row, text, col=1):
    c = ws.cell(row=row, column=col, value=text)
    c.font = SMALL
    return c


def hours_formula(rng, sym_rows):
    """記号ごとの件数 × 実働時間（凡例シートの値を参照）の合計。"""
    terms = [f"COUNTIF({rng},'{SHEET_SYM}'!$A${r})*'{SHEET_SYM}'!$F${r}" for r in sym_rows]
    return '=' + '+'.join(terms)


def count_formula(rng, symbols):
    return '=' + '+'.join(f'COUNTIF({rng},"{s}")' for s in symbols)


# ------------------------------------------------------------
#  ② シフト記号（凡例）
# ------------------------------------------------------------
def sheet_symbols(wb, cfg):
    ws = wb.create_sheet(SHEET_SYM)
    ws['A1'] = 'シフト記号（この表を直すと、シフト表の労働時間も変わります）'
    ws['A1'].font = TITLE
    note(ws, 2, '実働時間は「終了−開始−休憩」を時間で入れる。記号を増やしたら行を追加して、'
                'シフト表の入力候補にも足すこと（記号は1文字が使いやすい）。')
    HROW = 4
    head_row(ws, HROW, ['記号', '名称', '開始', '終了', '休憩(分)', '実働時間', '出勤扱い'],
             [8, 14, 9, 9, 10, 11, 10])
    r = HROW
    for sym, name, start, end, rest, hours, work in cfg['symbols']:
        r += 1
        put(ws, r, 1, sym, BOLD, align='center')
        put(ws, r, 2, name, BODY)
        put(ws, r, 3, start, BODY, align='center')
        put(ws, r, 4, end, BODY, align='center')
        put(ws, r, 5, rest, BODY, NUM, align='center')
        put(ws, r, 6, hours, BLUE, HOUR, fill=INPUT, align='center')
        put(ws, r, 7, '○' if work else 'ー', BODY, align='center')
    first, last = HROW + 1, r
    o = cfg['hours']
    r += 2
    ws.cell(row=r, column=1, value=f"営業時間: {o['open']}〜{o['close']}（{o['note']}）").font = SMALL
    r += 1
    ws.cell(row=r, column=1,
            value=f"開店をカバーする記号: {'・'.join(cfg['open_symbols'])}　／　"
                  f"閉店をカバーする記号: {'・'.join(cfg['close_symbols'])}").font = SMALL
    r += 1
    ws.cell(row=r, column=1, value='※「有」は労働時間には入れません（賃金は就業規則に従って支払う）。').font = SMALL
    return first, last


# ------------------------------------------------------------
#  ① シフト表（月間）
# ------------------------------------------------------------
def sheet_shift(wb, cfg, y, m, sym_first):
    ws = wb.create_sheet(SHEET_SHIFT)
    ndays = calendar.monthrange(y, m)[1]
    work_syms = [s[0] for s in cfg['symbols'] if s[6]]
    all_syms = [s[0] for s in cfg['symbols']]
    work_rows = [sym_first + i for i, s in enumerate(cfg['symbols']) if s[6]]

    ws['A1'] = f'シフト表（{y}年{m}月・{cfg["store"]}）'
    ws['A1'].font = TITLE
    note(ws, 2, '記号を選んで入れるだけ。労働時間・人件費・人数不足・開店／閉店の穴は自動で出ます。'
                '記号の意味と実働時間は「シフト記号」シート。')

    HROW = 4
    DAY0 = 4                      # D列から日付
    LASTDAY = DAY0 + ndays - 1
    head_row(ws, HROW, ['スタッフ', '区分', '時給'], [14, 14, 8])
    for i, h in enumerate(['出勤日数', '労働時間', '人件費の目安'], LASTDAY + 1):
        c = ws.cell(row=HROW, column=i, value=h)
        c.font = HEAD
        c.fill = NAVY
        c.border = B
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = 11
    for d in range(1, ndays + 1):
        col = DAY0 + d - 1
        wd = WD[date(y, m, d).weekday()]
        c = ws.cell(row=HROW, column=col, value=d)
        c.font = HEAD
        c.fill = NAVY
        c.border = B
        c.alignment = Alignment(horizontal='center')
        c2 = ws.cell(row=HROW + 1, column=col, value=wd)
        c2.font = SUN if wd == '日' else (SAT if wd == '土' else SMALL)
        c2.border = B
        c2.alignment = Alignment(horizontal='center')
        if wd in '土日':
            c2.fill = WEEKEND
        ws.column_dimensions[get_column_letter(col)].width = 4.2
    for i, label in enumerate(['', '', '曜日'], 1):
        c = ws.cell(row=HROW + 1, column=i, value=label)
        c.font = SMALL
        c.border = B
        c.alignment = Alignment(horizontal='center')
    for i in range(LASTDAY + 1, LASTDAY + 4):
        c = ws.cell(row=HROW + 1, column=i)
        c.border = B
        c.fill = GRAY

    first = HROW + 2
    staff = list(cfg['staff'])
    while len(staff) < 10:        # 空行。人が増えたらここに書く
        staff.append(['', '', '', ''])
    r = first - 1
    for name, kind, wage, memo in staff:
        r += 1
        put(ws, r, 1, name, BLUE)
        put(ws, r, 2, kind, BLUE, align='center')
        put(ws, r, 3, (int(wage) if str(wage).isdigit() else None), BLUE, YEN,
            fill=INPUT, align='center')
        for d in range(1, ndays + 1):
            put(ws, r, DAY0 + d - 1, None, BLUE, align='center')
        rng = f'{get_column_letter(DAY0)}{r}:{get_column_letter(LASTDAY)}{r}'
        put(ws, r, LASTDAY + 1, count_formula(rng, work_syms), BODY, NUM, align='center')
        put(ws, r, LASTDAY + 2, hours_formula(rng, work_rows), BODY, HOUR, align='center')
        cl = get_column_letter(LASTDAY + 2)
        put(ws, r, LASTDAY + 3, f'=IF(N(C{r})=0,"",{cl}{r}*C{r})', BODY, YEN, align='center')
    last = r

    # --- 日ごとの人数と穴のチェック ---
    rows = {}
    for label, kind in [('出勤人数', 'count'), ('必要人数', 'need'),
                        ('過不足', 'gap'), ('開店', 'open'), ('閉店', 'close')]:
        r += 1
        rows[kind] = r
        put(ws, r, 1, label, BOLD, fill=TOTAL)
        put(ws, r, 2, None, BOLD, fill=TOTAL)
        put(ws, r, 3, None, BOLD, fill=TOTAL)
        for i in range(LASTDAY + 1, LASTDAY + 4):
            put(ws, r, i, None, BOLD, fill=TOTAL)
    for d in range(1, ndays + 1):
        col = DAY0 + d - 1
        L = get_column_letter(col)
        wd = WD[date(y, m, d).weekday()]
        rng = f'{L}{first}:{L}{last}'
        put(ws, rows['count'], col, count_formula(rng, work_syms), BOLD, NUM,
            fill=TOTAL, align='center')
        put(ws, rows['need'], col, cfg['required'].get(wd, 2), BLUE, NUM,
            fill=INPUT, align='center')
        put(ws, rows['gap'], col,
            f"={L}{rows['count']}-{L}{rows['need']}", BOLD, NUM, fill=TOTAL, align='center')
        put(ws, rows['open'], col,
            count_formula(rng, cfg['open_symbols']).replace('=', '=IF(', 1) + '=0,"×","○")',
            BOLD, None, fill=TOTAL, align='center')
        put(ws, rows['close'], col,
            count_formula(rng, cfg['close_symbols']).replace('=', '=IF(', 1) + '=0,"×","○")',
            BOLD, None, fill=TOTAL, align='center')

    # --- 合計 ---
    r = rows['close'] + 1
    put(ws, r, 1, '合計', BOLD, fill=GRAY)
    put(ws, r, 2, None, BOLD, fill=GRAY)
    put(ws, r, 3, None, BOLD, fill=GRAY)
    for d in range(1, ndays + 1):
        put(ws, r, DAY0 + d - 1, None, BOLD, fill=GRAY)
    for i, fmt in [(LASTDAY + 1, NUM), (LASTDAY + 2, HOUR), (LASTDAY + 3, YEN)]:
        L = get_column_letter(i)
        put(ws, r, i, f'=SUM({L}{first}:{L}{last})', BOLD, fmt, fill=GRAY, align='center')
    total_row = r

    dv = DataValidation(type='list', formula1='"' + ','.join(all_syms) + '"',
                        allow_blank=True, showErrorMessage=True,
                        error='シフト記号シートにある記号を選んでください', errorTitle='シフト記号')
    ws.add_data_validation(dv)
    dv.add(f'{get_column_letter(DAY0)}{first}:{get_column_letter(LASTDAY)}{last}')

    area = f'{get_column_letter(DAY0)}{rows["gap"]}:{get_column_letter(LASTDAY)}{rows["gap"]}'
    ws.conditional_formatting.add(area, CellIsRule(
        operator='lessThan', formula=['0'],
        fill=PatternFill('solid', bgColor='FFC7CE'), font=Font(color='9C0006', bold=True)))
    for kind in ('open', 'close'):
        rng = (f'{get_column_letter(DAY0)}{rows[kind]}:'
               f'{get_column_letter(LASTDAY)}{rows[kind]}')
        ws.conditional_formatting.add(rng, CellIsRule(
            operator='equal', formula=['"×"'],
            fill=PatternFill('solid', bgColor='FFC7CE'), font=Font(color='9C0006', bold=True)))

    ws.freeze_panes = f'{get_column_letter(DAY0)}{first}'
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return first, last, DAY0, LASTDAY, total_row


# ------------------------------------------------------------
#  ③ 希望シフト（スタッフに配る）
# ------------------------------------------------------------
def sheet_wish(wb, cfg, y, m):
    ws = wb.create_sheet('希望シフト')
    ndays = calendar.monthrange(y, m)[1]
    ws['A1'] = f'希望シフト提出（{y}年{m}月）'
    ws['A1'].font = TITLE
    note(ws, 2, cfg['wish_note'] + '　' + cfg['wish_deadline'])
    HROW = 4
    DAY0 = 3
    head_row(ws, HROW, ['スタッフ', '希望の合計時間'], [14, 13])
    for d in range(1, ndays + 1):
        col = DAY0 + d - 1
        wd = WD[date(y, m, d).weekday()]
        c = ws.cell(row=HROW, column=col, value=d)
        c.font = HEAD
        c.fill = NAVY
        c.border = B
        c.alignment = Alignment(horizontal='center')
        c2 = ws.cell(row=HROW + 1, column=col, value=wd)
        c2.font = SUN if wd == '日' else (SAT if wd == '土' else SMALL)
        c2.border = B
        c2.alignment = Alignment(horizontal='center')
        if wd in '土日':
            c2.fill = WEEKEND
        ws.column_dimensions[get_column_letter(col)].width = 4.2
    put(ws, HROW + 1, 1, None, SMALL)
    put(ws, HROW + 1, 2, '（○の数）', SMALL, align='center')
    lastday = DAY0 + ndays - 1
    first = HROW + 2
    staff = [s[0] for s in cfg['staff']] + [''] * 5
    r = first - 1
    for name in staff:
        r += 1
        put(ws, r, 1, name, BLUE)
        rng = f'{get_column_letter(DAY0)}{r}:{get_column_letter(lastday)}{r}'
        put(ws, r, 2, f'=COUNTIF({rng},"○")', BODY, NUM, align='center')
        for d in range(1, ndays + 1):
            put(ws, r, DAY0 + d - 1, None, BLUE, align='center')
    last = r
    r += 1
    put(ws, r, 1, '出勤できる人数', BOLD, fill=TOTAL)
    put(ws, r, 2, None, BOLD, fill=TOTAL)
    for d in range(1, ndays + 1):
        L = get_column_letter(DAY0 + d - 1)
        put(ws, r, DAY0 + d - 1, f'=COUNTIF({L}{first}:{L}{last},"○")', BOLD, NUM,
            fill=TOTAL, align='center')
    dv = DataValidation(type='list', formula1='"' + ','.join(cfg['wish_marks']) + '"',
                        allow_blank=True, showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add(f'{get_column_letter(DAY0)}{first}:{get_column_letter(lastday)}{last}')
    ws.freeze_panes = f'{get_column_letter(DAY0)}{first}'
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return ws


# ------------------------------------------------------------
#  ④ 集計・労務チェック
# ------------------------------------------------------------
def sheet_summary(wb, cfg, y, m, shift, sym_rows):
    first, last, DAY0, LASTDAY, total_row = shift
    ndays = calendar.monthrange(y, m)[1]
    ws = wb.create_sheet('集計・労務チェック')
    ws['A1'] = f'集計と労務チェック（{y}年{m}月）'
    ws['A1'].font = TITLE
    note(ws, 2, '週の労働時間が40時間を超えると赤くなります。'
                'シフト表を直すとここも自動で変わります（この表は目安。就業規則を確認のこと）。')

    # 週（月曜始まり）の日付をまとめる
    weeks = []
    cur = []
    for d in range(1, ndays + 1):
        cur.append(d)
        if date(y, m, d).weekday() == 6 or d == ndays:
            weeks.append(cur)
            cur = []

    HROW = 4
    heads = ['スタッフ'] + [f'第{i}週' for i in range(1, len(weeks) + 1)] + ['月合計', '判定']
    head_row(ws, HROW, heads, [14] + [10] * len(weeks) + [11, 22])
    r = HROW
    for sr in range(first, last + 1):
        r += 1
        put(ws, r, 1, f"=IF('{SHEET_SHIFT}'!A{sr}=\"\",\"\",'{SHEET_SHIFT}'!A{sr})", BODY)
        for wi, days in enumerate(weeks, 1):
            c1 = get_column_letter(DAY0 + days[0] - 1)
            c2 = get_column_letter(DAY0 + days[-1] - 1)
            rng = f"'{SHEET_SHIFT}'!{c1}{sr}:{c2}{sr}"
            put(ws, r, 1 + wi, hours_formula(rng, sym_rows), BODY, HOUR, align='center')
        wl = get_column_letter(1 + len(weeks))
        put(ws, r, 2 + len(weeks), f'=SUM(B{r}:{wl}{r})', BOLD, HOUR, align='center')
        put(ws, r, 3 + len(weeks),
            f'=IF(MAX(B{r}:{wl}{r})>40,"週40時間を超えている週があります","")', RED, wrap=True)
    ws.conditional_formatting.add(
        f'B{HROW + 1}:{get_column_letter(1 + len(weeks))}{r}',
        CellIsRule(operator='greaterThan', formula=['40'],
                   fill=PatternFill('solid', bgColor='FFC7CE'), font=Font(color='9C0006',
                                                                          bold=True)))

    # --- 人件費 ---
    r += 2
    ws.cell(row=r, column=1, value='人件費の目安').font = H2
    r += 1
    head_row(ws, r, ['項目', '値', '見方'])
    ws.column_dimensions['C'].width = 46
    cost_col = get_column_letter(LASTDAY + 3)
    hour_col = get_column_letter(LASTDAY + 2)
    items = [
        ('総労働時間（月）', f"='{SHEET_SHIFT}'!{hour_col}{total_row}", HOUR,
         'シフト表の合計。有給は含みません'),
        ('人件費の目安（時給者のみ）', f"='{SHEET_SHIFT}'!{cost_col}{total_row}", YEN,
         '月給者は含まれません。B列に月給の合計を足して見ること'),
        ('月給者の人件費（手入力）', 0, YEN, '社員の月給合計を入れる（青字・書き換え可）'),
        ('人件費の合計', None, YEN, '時給者＋月給者'),
        ('売上目標（手入力）', 0, YEN, 'KPI記録シートの売上目標と同じ数字を入れる'),
        ('人件費率', None, PCT, f"目安 {int(cfg['cost']['target_rate'] * 100)}%以下"
                                f"（{cfg['cost']['note']}）"),
    ]
    base = r + 1
    for i, (label, value, fmt, how) in enumerate(items):
        rr = base + i
        put(ws, rr, 1, label, BOLD)
        if label == '人件費の合計':
            put(ws, rr, 2, f'=B{base + 1}+B{base + 2}', BOLD, fmt, align='center')
        elif label == '人件費率':
            put(ws, rr, 2, f'=IF(N(B{base + 4})=0,"",B{base + 3}/B{base + 4})', BOLD, fmt,
                align='center')
        else:
            font = BLUE if isinstance(value, int) else BODY
            fill = INPUT if isinstance(value, int) else None
            put(ws, rr, 2, value, font, fmt, fill=fill, align='center')
        put(ws, rr, 3, how, SMALL, wrap=True)
    rate_row = base + 5
    ws.conditional_formatting.add(f'B{rate_row}', CellIsRule(
        operator='greaterThan', formula=[str(cfg['cost']['target_rate'])],
        fill=PatternFill('solid', bgColor='FFC7CE'), font=Font(color='9C0006', bold=True)))

    # --- 労務の注意 ---
    r = rate_row + 2
    ws.cell(row=r, column=1, value='シフトを組むときに守ること').font = H2
    for text in cfg['labor_notes']:
        r += 1
        put(ws, r, 1, '☐', BOLD, align='center')
        c = ws.cell(row=r, column=2, value=text)
        c.font = BODY
        c.alignment = Alignment(wrap_text=True, vertical='top')
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3 + len(weeks))
        ws.row_dimensions[r].height = 16 * max(1, -(-len(text) // 60)) + 4
    ws.freeze_panes = f'B{HROW + 1}'
    return ws


def main():
    cfg_path = arg('config', os.path.join(ROOT, 'config', 'shift.json'))
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    if arg('store'):
        cfg['store'] = arg('store')
    month = arg('month', f'{date.today():%Y-%m}')
    try:
        y, m = map(int, month.split('-'))
        datetime(y, m, 1)
    except ValueError:
        sys.exit(f'--month は YYYY-MM で指定してください（受け取った値: {month}）')

    wb = Workbook()
    wb.remove(wb.active)
    sym_first, _ = sheet_symbols(wb, cfg)
    work_rows = [sym_first + i for i, s in enumerate(cfg['symbols']) if s[6]]
    shift = sheet_shift(wb, cfg, y, m, sym_first)
    sheet_wish(wb, cfg, y, m)
    sheet_summary(wb, cfg, y, m, shift, work_rows)
    # 順番を「シフト表 → 記号 → 希望 → 集計」に並べ替える
    wb.move_sheet(SHEET_SHIFT, offset=-1)

    out = arg('out', os.path.join(ROOT, 'out', f'シフト表_{cfg["store"]}_{month}.xlsx'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wb.save(out)
    print(f'できました: {out}')
    print(f"  シート: {' / '.join(ws.title for ws in wb.worksheets)}")
    print('  記号を入れるだけで、労働時間・人件費・人数不足・開店／閉店の穴が出ます。')


if __name__ == '__main__':
    main()
