#!/usr/bin/env python3
"""在庫スケジュール統合ブックを生成する。

  python3 scripts/buildStockWorkbook.py
  → out/在庫スケジュール_統合版.xlsx （7シート）

シート構成:
  ①在庫スケジュール(日本語)   出荷予定日順のコンテナ一覧（PL/BL/AN はドロップダウン）
  ②库存计划表(中文)           ①の中国語版（工場共有用）
  ③現在庫(9-4)                スーツケース在庫スナップショット
  ④消化スケジュール           在庫日数・欠品予測
  ⑤その他商品在庫(9-4)        ファン・ドライヤー等
  ⑥発注判断(在庫切れ予測)     日販×入荷予定から在庫切れ日を算出（🟥表示）
  ⑦在庫推移カレンダー         週次の在庫推移（在庫0は🟥）

out/ は .gitignore 対象のため、必要なときにこのスクリプトで作り直す。
"""
import csv, datetime, os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(ROOT, 'out')
TODAY = datetime.date(2026, 9, 6)
STOCK_DATE = datetime.date(2026, 9, 4)
HORIZON = datetime.date(2026, 12, 31)
TRANSIT = 14  # 出荷→到着の実績平均日数

thin = Side(style='thin', color='B0B0B0')
BD = Border(left=thin, right=thin, top=thin, bottom=thin)
HF = PatternFill('solid', fgColor='1F4E78')
DHF = PatternFill('solid', fgColor='2E75B6')
HFo = Font(bold=True, color='FFFFFF', size=11)
TF = Font(bold=True, size=14, color='1F4E78')
SUBF = Font(size=9, color='808080')
GF = PatternFill('solid', fgColor='4472C4')
GFo = Font(bold=True, color='FFFFFF', size=11)
TOT = PatternFill('solid', fgColor='F8CBAD')
TOTo = Font(bold=True, size=11)
RED = PatternFill('solid', fgColor='FF0000')
ORG = PatternFill('solid', fgColor='FFC000')
YEL = PatternFill('solid', fgColor='FFFF00')
GRN = PatternFill('solid', fgColor='C6EFCE')
GRY = PatternFill('solid', fgColor='D9D9D9')
BLU = PatternFill('solid', fgColor='BDD7EE')
NG = PatternFill('solid', fgColor='FFC7CE')
C = Alignment(horizontal='center', vertical='center')
L = Alignment(horizontal='left', vertical='center', wrap_text=True)
LN = Alignment(horizontal='left', vertical='center')

# 日販（8/2実績を引き継ぎ）
DPS = {'101': 12.1, '103a': 0.3, '105': 1.4, '106': 12.8, '107': 7.8, '108': 5.7,
       '109': 0.0, '110': 0.6, '111': 3.5,
       '201': 4.5, '206': 7.3, '207': 5.7, '208': 4.3, '210': 0.8, '211': 3.3,
       '301': 2.3, '306': 2.2, '307': 6.1, '308': 1.1, '310': 1.5}

# 出荷予定日, 発注, 商品名JP, 商品名CN, サイズ, 数量, コンテナ, 状況JP, 状況CN, PL, BL, AN, 備考JP, 備考CN
SCHEDULE = [
 ('2026/1/16','LM251008','PCスーツケース','PC拉杆箱','L',599,'CAAU8766326','入庫済','已入库',1,1,1,'通関完了・倉庫入荷済み・書類3点完備','已通关・已入库・单证齐全'),
 ('2026/1/16','LM251008','多機能PC/アルミ','多功能PC/铝合金箱','S/M',733,'IAAU1910400','入庫済','已入库',1,1,1,'通関完了・倉庫入荷済み・書類3点完備','已通关・已入库・单证齐全'),
 ('2026/7/23','LM260507','多機能PC(混載)','多功能PC(混装)','-',1060,'TWIU4232923','入庫済','已入库',1,1,1,'通関完了・8/5着','已通关・8/5到港'),
 ('2026/7/24','LM260507','多機能PC','多功能PC拉杆箱','M/S',745,'IAAU1022523','入庫済','已入库',1,1,1,'通関済・8/27入庫','已通关・8/27入库'),
 ('2026/7/31','LM260320','多機能アルミ','多功能铝合金箱','S',381,'IAAU2971329','入庫済','已入库',1,1,1,'通関済・8/22入庫','已通关・8/22入库'),
 ('2026/8/7','LM260507','多機能PC','多功能PC拉杆箱','L',606,'WHSU5628824','入庫済','已入库',1,1,1,'通関済・8/22入庫','已通关・8/22入库'),
 ('2026/8/13','LM26320','ノーマルアルミ','普通铝合金箱','M',590,'WHSU5830223','入庫済','已入库',1,1,1,'通関完了・入庫済み','已通关・已入库'),
 ('2026/8/17','LM260320','ジップタイプ','拉链款多功能PC箱','S・M+S',1093,'EITU1030111','入庫済','已入库',1,1,1,'通関完了・入庫済み','已通关・已入库'),
 ('2026/8/17','LM260320','ジップタイプ＋多機能アルミ','拉链款多功能PC箱+铝合金箱','S・M+S',633,'CAAU5731521','入庫済','已入库',1,1,1,'通関完了・入庫済み','已通关・已入库'),
 ('2026/8/25','LM260512','多機能PC＋ノーマルアルミ','多功能PC+普通铝合金箱','S',1077,'TSSU5227711','出荷済み','已出货',1,1,0,'輸送中・9/8着予定・AN待ち','运输中・9/8到港・待到货通知'),
 ('2026/8/27','LM260512','多機能PC＋ノーマルアルミ','多功能PC+普通铝合金箱','M',722,'WHSU5516465','出荷済み','已出货',1,1,1,'輸送中・9/7着予定・書類完備','运输中・9/7到港・单证齐全'),
 ('2026/9/3','LM260512','多機能PC','多功能PC拉杆箱','L',607,'CAAU8818353','出荷済み','已出货',1,0,0,'輸送中・9/14着予定・BL待ち','运输中・9/14到港・待提单'),
 ('2026/9/10','注文6/18','多機能PC','多功能PC拉杆箱','S',1100,'（未割当）','生産中','生产中',0,0,0,'',''),
 ('2026/9/15','注文6/18','多機能PC','多功能PC拉杆箱','S',1100,'（未割当）','生産中','生产中',0,0,0,'',''),
 ('2026/9/20','注文6/18','多機能PC','多功能PC拉杆箱','M',700,'（未割当）','生産中','生产中',0,0,0,'',''),
 ('2026/9/20','注文7/4','混載(PC S/M＋アルミ)','混装(PC S/M+铝合金)','混載',813,'（未割当）','生産中','生产中',0,0,0,'概算・内訳未確定','概算・明细未定'),
 ('2026/9/25','注文6/18','多機能PC','多功能PC拉杆箱','L',600,'（未割当）','生産中','生产中',0,0,0,'',''),
 ('2026/9/30','注文7/4','混載(PC S/M＋アルミ)','混装(PC S/M+铝合金)','混載',813,'（未割当）','生産中','生产中',0,0,0,'概算・内訳未確定','概算・明细未定'),
 ('2026/10/5','注文7/4','混載(PC S/M＋アルミ)','混装(PC S/M+铝合金)','混載',812,'（未割当）','生産中','生产中',0,0,0,'概算・内訳未確定','概算・明细未定'),
 ('2026/10/10','注文7/4','混載(PC S/M＋アルミ)','混装(PC S/M+铝合金)','混載',812,'（未割当）','生産中','生产中',0,0,0,'概算・内訳未確定','概算・明细未定'),
 ('2026/11/10','LM20260808','多機能PC','多功能PC拉杆箱','L',650,'（未割当）','生産中','生产中',0,0,0,'集装箱1','集装箱1'),
 ('2026/11/15','LM20260808','多機能PC','多功能PC拉杆箱','M',750,'（未割当）','生産中','生产中',0,0,0,'集装箱2','集装箱2'),
 ('2026/11/25','LM20260808','多機能PC','多功能PC拉杆箱','S',1100,'（未割当）','生産中','生产中',0,0,0,'集装箱3','集装箱3'),
 ('2026/11/30','LM20260808','多機能PC','多功能PC拉杆箱','S',1100,'（未割当）','生産中','生产中',0,0,0,'集装箱4','集装箱4'),
 ('2026/12/5','LM20260808','多機能PC','多功能PC拉杆箱','M',750,'（未割当）','生産中','生产中',0,0,0,'集装箱5','集装箱5'),
 ('2026/12/10','LM20260808','多機能PC','多功能PC拉杆箱','L',650,'（未割当）','生産中','生产中',0,0,0,'集装箱6','集装箱6'),
 ('2026/12/15','LM20260808','多機能PC','多功能PC拉杆箱','S',1100,'（未割当）','生産中','生产中',0,0,0,'集装箱7','集装箱7'),
 ('2026/12/25','LM20260808','多機能PC','多功能PC拉杆箱','M',750,'（未割当）','生産中','生产中',0,0,0,'集装箱8','集装箱8'),
 ('2027/1/5','LM20260808','多機能PC','多功能PC拉杆箱','S',1100,'（未割当）','生産中','生产中',0,0,0,'集装箱9','集装箱9'),
 ('2027/1/10','LM20260808','多機能PC','多功能PC拉杆箱','M',750,'（未割当）','生産中','生产中',0,0,0,'集装箱10','集装箱10'),
 ('2027/1/15','LM20260808','多機能PC','多功能PC拉杆箱','M',750,'（未割当）','生産中','生产中',0,0,0,'集装箱11','集装箱11'),
 ('2027/1/20','LM20260808','多機能PC','多功能PC拉杆箱','L',650,'（未割当）','生産中','生产中',0,0,0,'集装箱12','集装箱12'),
 ('2027/1/30','LM20260808','多機能PC','多功能PC拉杆箱','L',650,'（未割当）','生産中','生产中',0,0,0,'集装箱13','集装箱13'),
 ('未定','サザンモデル','サザンモデル','南方款','S',1100,'（未割当）','生産中','生产中',0,0,0,'11月頭〜12月末 着予定／黒300灰200銀200白200ターコイズ200','11月初〜12月末到港／黑300灰200银200白200绿松石200'),
 ('未定','サザンモデル','サザンモデル','南方款','M',750,'（未割当）','生産中','生产中',0,0,0,'11月頭〜12月末 着予定／生産800・50個中国保管','11月初〜12月末到港／生产800・50个中国保管'),
 ('未定','サザンモデル','サザンモデル','南方款','L',650,'（未割当）','生産中','生产中',0,0,0,'11月頭〜12月末 着予定／黒250銀200灰200','11月初〜12月末到港／黑250银200灰200'),
 ('要確認','要確認','スポーツタイプ','运动款','要確認','','要確認','出荷済み','已出货',0,0,0,'※データ未登録・要確認','※数据未登记・待确认'),
]

STFILL = {'入庫済': GRN, '出荷済み': BLU, '生産中': YEL,
          '已入库': GRN, '已出货': BLU, '生产中': YEL}


def ship_key(row):
    try:
        y, m, d = [int(x) for x in row[0].split('/')]
        return (0, datetime.date(y, m, d))
    except ValueError:
        return (1, datetime.date(2099, 1, 1))


def arrive(ship, days=TRANSIT):
    y, m, d = [int(x) for x in ship.split('/')]
    return datetime.date(y, m, d) + datetime.timedelta(days=days)


def load_inventory():
    def rd(name):
        with open(os.path.join(DATA, name), encoding='utf-8-sig') as f:
            return list(csv.DictReader(f))
    return rd('inventory-suitcase-2026-09-04.csv'), rd('inventory-other-2026-09-04.csv')


def simulate(suit):
    """SKU別に日次で在庫を回し、初回欠品日・週次推移を返す。"""
    sku = {}
    for r in suit:
        if r['カテゴリ'].startswith('スーツケース'):
            sku[r['SKU']] = {'name': r['商品名'], 'stock': int(r['総在庫']),
                             'dps': DPS.get(r['SKU'], 0.0), 'size': r['カテゴリ'][-1]}
    sku['111L'] = {'name': 'エナメルカーキ L(新色)', 'stock': 0, 'dps': 0.0, 'size': 'L'}

    # 確定3本＝パッキングリストの色別内訳
    arrivals = [
        (datetime.date(2026, 9, 7), {'201': 100, '207': 200, '210': 100, '208': 100, '206': 200}, 'WHSU5516465'),
        (datetime.date(2026, 9, 8), {'111': 200, '103a': 100, '109': 100, '108': 200, '107': 200, '110': 250}, 'TSSU5227711'),
        (datetime.date(2026, 9, 14), {'301': 208, '306': 399}, 'CAAU8818353'),
    ]
    # LM20260808＝発注書（写真）の色別内訳。磨砂=マット／镜面=エナメル
    for ship, items in [
        ('2026/11/10', {'307': 200, '111L': 150, '310': 200, '308': 100}),
        ('2026/11/15', {'206': 200, '207': 200, '201': 150, '208': 100, '211': 100}),
        ('2026/11/25', {'106': 200, '101': 300, '108': 200, '111': 100, '105': 300}),
        ('2026/11/30', {'106': 400, '101': 300, '108': 200, '111': 200}),
        ('2026/12/5',  {'206': 100, '207': 100, '201': 150, '208': 200, '211': 200}),
        ('2026/12/10', {'307': 200, '301': 100, '310': 200, '308': 150}),
        ('2026/12/15', {'106': 100, '101': 400, '108': 400, '111': 200}),
        ('2026/12/25', {'206': 200, '207': 250, '201': 200, '208': 100}),
    ]:
        arrivals.append((arrive(ship), items, 'LM20260808'))
    # 注文6/18＝内訳未定のためサイズ内で日販按分
    for ship, size, qty in [('2026/9/10', 'S', 1100), ('2026/9/15', 'S', 1100),
                            ('2026/9/20', 'M', 700), ('2026/9/25', 'L', 600)]:
        ks = [k for k, v in sku.items() if v['size'] == size and v['dps'] > 0]
        tot = sum(sku[k]['dps'] for k in ks)
        arrivals.append((arrive(ship), {k: round(qty * sku[k]['dps'] / tot) for k in ks}, '注文6/18(按分)'))
    arrivals.sort(key=lambda x: x[0])

    next_arr = {}
    for ad, items, src in arrivals:
        for k, q in items.items():
            next_arr.setdefault(k, (ad, q, src))

    stock = {k: v['stock'] for k, v in sku.items()}
    hist = {k: {} for k in sku}
    first_out = {}
    cur = STOCK_DATE
    while cur <= HORIZON:
        for ad, items, _ in arrivals:
            if ad == cur:
                for k, q in items.items():
                    stock[k] = stock.get(k, 0) + q
        for k, v in sku.items():
            if v['dps'] > 0:
                stock[k] = max(0, stock[k] - v['dps'])
                if stock[k] <= 0 and k not in first_out:
                    first_out[k] = cur
            hist[k][cur] = round(stock[k])
        cur += datetime.timedelta(days=1)
    return sku, hist, first_out, next_arr


def sheet_schedule(wb, name, pos, title, sub, hdr, name_i, st_i, note_i, totlabel, yes, no, statlist):
    ws = wb.create_sheet(name, pos)
    ws['A1'] = title; ws['A1'].font = TF
    ws['A2'] = sub; ws['A2'].font = SUBF
    for c, h in enumerate(hdr, 1):
        y = ws.cell(4, c, h)
        y.fill = DHF if c in (9, 10, 11) else HF
        y.font = HFo; y.alignment = C; y.border = BD
    r = 5; tot = 0; n = 0; year = None; rows = []
    for d in sorted(SCHEDULE, key=ship_key):
        yv = d[0].split('/')[0] if '/' in d[0] else '日付未定'
        if yv != year:
            year = yv
            ws.cell(r, 1, f'{yv}年' if yv != '日付未定' else '日付未定')
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12)
            for c in range(1, 13):
                y = ws.cell(r, c); y.fill = GF; y.font = GFo; y.alignment = LN
            r += 1
        n += 1
        vals = [n, d[0], d[1], d[name_i], d[4], d[5], d[6], d[st_i],
                yes if d[9] else no, yes if d[10] else no, yes if d[11] else no, d[note_i]]
        for c, v in enumerate(vals, 1):
            y = ws.cell(r, c, v); y.border = BD
            y.alignment = L if c in (4, 12) else C
            if c == 8:
                y.fill = STFILL.get(v, PatternFill()); y.font = Font(bold=True)
            if c in (9, 10, 11):
                y.fill = GRN if v == yes else NG
        if isinstance(d[5], int):
            tot += d[5]
        rows.append(r); r += 1
    ws.cell(r, 4, totlabel); ws.cell(r, 6, tot)
    for c in range(1, 13):
        y = ws.cell(r, c); y.fill = TOT; y.font = TOTo; y.alignment = C; y.border = BD
    dv = DataValidation(type='list', formula1=f'"{yes},{no}"', allow_blank=True, showDropDown=False)
    dv2 = DataValidation(type='list', formula1=f'"{statlist}"', allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv); ws.add_data_validation(dv2)
    for rr in rows:
        for col in ('I', 'J', 'K'):
            dv.add(f'{col}{rr}')
        dv2.add(f'H{rr}')
    for i, w in enumerate([5, 14, 13, 26, 10, 9, 15, 11, 15, 9, 12, 34], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A5'


def sheet_inventory(wb, name, title, sub, rows):
    ws = wb.create_sheet(name)
    ws['A1'] = title; ws['A1'].font = TF
    ws['A2'] = sub; ws['A2'].font = SUBF
    hdr = ['カテゴリ', '商品名', 'SKU', 'FBA出荷可', 'FBA合計', 'CS倉庫 良品',
           'CS倉庫 確保分', '出品者出荷(FBM)', '事務所(心斎橋)', '総在庫']
    for c, h in enumerate(hdr, 1):
        y = ws.cell(4, c, h); y.fill = HF; y.font = HFo; y.alignment = C; y.border = BD
    r = 5; cat = None; tot = 0
    for d in rows:
        if d['カテゴリ'] != cat:
            cat = d['カテゴリ']
            ws.cell(r, 1, '◼ ' + cat)
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=10)
            for c in range(1, 11):
                y = ws.cell(r, c); y.fill = GF; y.font = GFo; y.alignment = LN
            r += 1
        vals = [d['カテゴリ'], d['商品名'], d['SKU'], int(d['FBA出荷可']), int(d['FBA合計']),
                int(d['CS倉庫良品']), int(d['CS倉庫確保分']), int(d['出品者出荷']),
                int(d['事務所']), int(d['総在庫'])]
        for c, v in enumerate(vals, 1):
            y = ws.cell(r, c, v); y.border = BD; y.alignment = L if c == 2 else C
            if c == 10:
                y.font = Font(bold=True)
        tot += int(d['総在庫']); r += 1
    ws.cell(r, 2, '合計'); ws.cell(r, 10, tot)
    for c in range(1, 11):
        y = ws.cell(r, c); y.fill = TOT; y.font = TOTo; y.alignment = C; y.border = BD
    for i, w in enumerate([20, 30, 17, 11, 10, 12, 12, 14, 14, 10], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A5'
    return tot


def sheet_burn(wb, suit, sku, first_out, next_arr):
    ws = wb.create_sheet('④消化スケジュール')
    ws['A1'] = '消化スケジュール（在庫が何日もつか／欠品予測）'; ws['A1'].font = TF
    ws['A2'] = (f'基準日=在庫日{STOCK_DATE:%Y/%m/%d}。在庫日数=総在庫÷日販。'
                '日販は8/2実績を引き継ぎ（新SKUは未設定=「—」）。次回入荷はSKU別の直近便。'); ws['A2'].font = SUBF
    hdr = ['商品名', 'SKU', '総在庫', '日販', '在庫日数', '欠品予測日', '判定', '次回入荷日', '次回入荷数', '入荷元']
    for c, h in enumerate(hdr, 1):
        y = ws.cell(4, c, h); y.fill = HF; y.font = HFo; y.alignment = C; y.border = BD
    jgfill = {'欠品': RED, '要至急補充': RED, '要補充': NG, '注意': YEL, '適正': GRN, '日販未設定': GRY}
    r = 5
    for d in suit:
        k = d['SKU']; stock = int(d['総在庫'])
        v = sku.get(k); dps = v['dps'] if v else 0.0
        fo = first_out.get(k); na = next_arr.get(k)
        if stock == 0:
            days, out, jg = 0, STOCK_DATE.strftime('%Y/%m/%d'), '欠品'
        elif dps == 0:
            days, out, jg = '—', '—', '日販未設定'
        else:
            dd = stock / dps
            days = round(dd, 1)
            out = fo.strftime('%Y/%m/%d') if fo else '期間内なし'
            jg = '要至急補充' if dd < 14 else ('要補充' if dd < 30 else ('注意' if dd < 60 else '適正'))
        vals = [d['商品名'], k, stock, dps or '—', days, out, jg,
                na[0].strftime('%Y/%m/%d') if na else '予定なし', na[1] if na else '—', na[2] if na else '—']
        for c, x in enumerate(vals, 1):
            y = ws.cell(r, c, x); y.border = BD; y.alignment = L if c in (1, 10) else C
            if c == 7:
                y.fill = jgfill.get(x, PatternFill()); y.font = Font(bold=True)
        r += 1
    dv = DataValidation(type='list', formula1='"欠品,要至急補充,要補充,注意,適正,日販未設定"',
                        allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv); dv.add(f'G5:G{r-1}')
    for i, w in enumerate([30, 17, 10, 9, 10, 13, 13, 13, 12, 20], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A5'


def sheet_order_decision(wb, sku, first_out, next_arr):
    ws = wb.create_sheet('⑥発注判断(在庫切れ予測)')
    ws['A1'] = '発注判断シート ─ 日別販売ペース × 入荷予定から在庫切れ時期を算出'; ws['A1'].font = TF
    ws['A2'] = ('🟥=在庫切れ発生／🟧=60日以内に切れる／🟩=期間内は在庫あり。'
                '入荷内訳: 確定3本=パッキングリスト色別／LM20260808=発注書色別／注文6/18=日販按分。到着=出荷+14日。'); ws['A2'].font = SUBF
    hdr = ['サイズ', '商品名', 'SKU', '現在庫(9/4)', '日販', '在庫日数',
           '🟥在庫切れ予測日', '次回入荷日', '次回入荷数', '入荷元', '判定', '必要アクション']
    for c, h in enumerate(hdr, 1):
        y = ws.cell(4, c, h); y.fill = HF; y.font = HFo; y.alignment = C; y.border = BD
    order = sorted(sku, key=lambda k: ({'S': 0, 'M': 1, 'L': 2}[sku[k]['size']], k))
    r = 5; cur = None
    for k in order:
        v = sku[k]
        if v['size'] != cur:
            cur = v['size']
            ws.cell(r, 1, f'■ {cur}サイズ')
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12)
            for c in range(1, 13):
                y = ws.cell(r, c); y.fill = GF; y.font = GFo; y.alignment = LN
            r += 1
        fo = first_out.get(k); na = next_arr.get(k); dps = v['dps']
        days = round(v['stock'] / dps, 1) if dps > 0 else '—'
        if dps == 0:
            jg, act, fill = '日販未設定', '日販を設定してください', GRY
        elif fo and fo <= TODAY:
            jg, act, fill = '🟥欠品中', '至急補充／次便を前倒し', RED
        elif fo and (fo - TODAY).days <= 30:
            jg, act, fill = '🟥30日以内に欠品', '次便を前倒し・追加発注', RED
        elif fo and (fo - TODAY).days <= 60:
            jg, act, fill = '🟧60日以内に欠品', '発注検討', ORG
        elif fo:
            jg, act, fill = '🟨期間内に欠品', '入荷計画を確認', YEL
        else:
            jg, act, fill = '🟩余裕あり', '—', GRN
        vals = [v['size'], v['name'], k, v['stock'], dps or '—', days,
                fo.strftime('%Y/%m/%d') if fo else '期間内なし',
                na[0].strftime('%Y/%m/%d') if na else '予定なし',
                na[1] if na else '—', na[2] if na else '—', jg, act]
        for c, x in enumerate(vals, 1):
            y = ws.cell(r, c, x); y.border = BD; y.alignment = L if c in (2, 10, 12) else C
            if c == 7 and fo:
                y.fill = RED; y.font = Font(bold=True, color='FFFFFF')
            if c == 11:
                y.fill = fill
                y.font = Font(bold=True, color='FFFFFF' if fill is RED else '000000')
        r += 1
    dv = DataValidation(type='list',
                        formula1='"🟥欠品中,🟥30日以内に欠品,🟧60日以内に欠品,🟨期間内に欠品,🟩余裕あり,日販未設定"',
                        allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv); dv.add(f'K5:K{r-1}')
    for i, w in enumerate([7, 22, 8, 12, 8, 10, 18, 13, 12, 20, 18, 22], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'D5'


def sheet_calendar(wb, sku, hist):
    ws = wb.create_sheet('⑦在庫推移カレンダー')
    ws['A1'] = '在庫推移カレンダー（週次予測）　🟥=在庫0（欠品）'; ws['A1'].font = TF
    ws['A2'] = '9/4〜12/31を週次表示。🟥在庫0／🟧7日分未満／🟨14日分未満／白=余裕。日販未設定SKUは灰色。'; ws['A2'].font = SUBF
    dates = []
    d = STOCK_DATE
    while d <= HORIZON:
        dates.append(d); d += datetime.timedelta(days=7)
    for c, h in enumerate(['サイズ', '商品名', '日販'], 1):
        y = ws.cell(4, c, h); y.fill = HF; y.font = HFo; y.alignment = C; y.border = BD
    for i, dt in enumerate(dates):
        y = ws.cell(4, 4 + i, dt.strftime('%-m/%-d'))
        y.fill = HF; y.font = HFo; y.alignment = C; y.border = BD
        ws.column_dimensions[get_column_letter(4 + i)].width = 7
    order = sorted(sku, key=lambda k: ({'S': 0, 'M': 1, 'L': 2}[sku[k]['size']], k))
    r = 5
    for k in order:
        v = sku[k]; dps = v['dps']
        for c, x in enumerate([v['size'], v['name'], dps or '—'], 1):
            y = ws.cell(r, c, x); y.border = BD; y.alignment = L if c == 2 else C
        for i, dt in enumerate(dates):
            val = hist[k].get(dt, 0)
            y = ws.cell(r, 4 + i, val); y.border = BD; y.alignment = C
            if dps == 0:
                y.fill = GRY
            elif val <= 0:
                y.fill = RED; y.font = Font(bold=True, color='FFFFFF')
            elif val < dps * 7:
                y.fill = ORG
            elif val < dps * 14:
                y.fill = YEL
        r += 1
    for col, w in (('A', 7), ('B', 22), ('C', 7)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = 'D5'


def main():
    suit, other = load_inventory()
    sku, hist, first_out, next_arr = simulate(suit)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    sheet_schedule(wb, '①在庫スケジュール(日本語)', 0,
        '在庫スケジュール（出荷予定日順・全37本）',
        f'as of {TODAY:%Y/%m/%d}　※出荷予定日の古い順。状況・パッキングリスト・BL・アライバルはドロップダウンで変更できます。',
        ['No.', '出荷予定日', '発注No.', '商品名', 'サイズ', '数量', 'コンテナ番号', '状況',
         'パッキングリスト', 'BL', 'アライバル', '備考'],
        2, 7, 12, f'合計（{len(SCHEDULE)}本）', '受領済', '未受領', '入庫済,出荷済み,生産中')
    sheet_schedule(wb, '②库存计划表(中文)', 1,
        '库存计划表（按预计出货日排序・共37柜）',
        f'截至 {TODAY:%Y/%m/%d}　※按预计出货日先后排序。状态・装箱单・提单・到货通知可用下拉菜单选择。',
        ['No.', '预计出货日', '订单号', '品名', '尺寸', '数量', '柜号', '状态',
         '装箱单', '提单', '到货通知', '备注'],
        3, 8, 13, f'合计（{len(SCHEDULE)}柜）', '已收到', '未收到', '已入库,已出货,生产中')
    t3 = sheet_inventory(wb, '③現在庫(9-4)', f'現在庫（スーツケース）{STOCK_DATE:%Y/%m/%d} 時点',
        'データ元: FBA在庫・CS倉庫=キントーン在庫報告9/4添付CSV ／ 事務所(心斎橋)=9/4スクリーンショット。'
        '総在庫=FBA合計+CS良品+CS確保分+出品者出荷+事務所。', suit)
    sheet_burn(wb, suit, sku, first_out, next_arr)
    t5 = sheet_inventory(wb, '⑤その他商品在庫(9-4)', f'現在庫（その他商品）{STOCK_DATE:%Y/%m/%d} 時点',
        'ハンディファン・ドライヤー・フェイスクレンザー等。データ元は③と同じ。', other)
    sheet_order_decision(wb, sku, first_out, next_arr)
    sheet_calendar(wb, sku, hist)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, '在庫スケジュール_統合版.xlsx')
    wb.save(path)
    print('saved', path)
    print('sheets:', wb.sheetnames)
    print(f'スーツケース総在庫 {t3:,} / その他 {t5:,}')
    risky = sorted(((k, v) for k, v in first_out.items()), key=lambda x: x[1])
    print('\n=== 在庫切れ予測（早い順） ===')
    for k, d in risky:
        print(f'  {sku[k]["name"]:22s} {d:%Y/%m/%d}')


if __name__ == '__main__':
    main()
