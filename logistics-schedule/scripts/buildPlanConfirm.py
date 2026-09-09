#!/usr/bin/env python3
"""生産計画の日中対照表（日本↔中国の認識合わせ用）を出力する。

  python3 scripts/buildPlanConfirm.py
  → out/生産計画_日中対照.txt   （LINE/メール貼り付け用）
  → out/生産計画_日中対照.xlsx  （日中を左右に並べた確認用シート）

書式（1行＝1色×1便）:
  注文番号 商品名:サイズ:カラー:数量:出荷日:余り

余りは色ごとの合計なので、その色の最終便の行にだけ数字を入れ、
それ以外の行は「－」とする（二重計上を避けるため）。
"""
import json, os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(ROOT, 'out')

# SKU → (日本語 商品名, サイズ, カラー) / (中文 品名, 尺寸, 颜色)
JP_SIZE = {'S': 'S', 'M': 'M', 'L': 'L', 'M+S': 'M+S'}
CN_SIZE = {'S': '20寸', 'M': '24寸', 'L': '28寸', 'M+S': '26寸'}

PC_COLORS = {
    '106': ('マットブラック', '磨砂黑色'), '107': ('マットシルバー', '磨砂银色'),
    '108': ('マットホワイト', '磨砂白色'), '110': ('マットグレー', '磨砂灰色'),
    '101': ('エナメルシルバー', '镜面银色'), '105': ('エナメルホワイト', '镜面白色'),
    '109': ('エナメルピンク', '镜面粉色'), '111': ('エナメルカーキ', '镜面卡其色'),
    '103a': ('エナメルスカイブルー', '镜面天蓝色'),
    '206': ('マットブラック', '磨砂黑色'), '207': ('マットシルバー', '磨砂银色'),
    '208': ('マットホワイト', '磨砂白色'), '210': ('マットグレー', '磨砂灰色'),
    '201': ('エナメルシルバー', '镜面银色'), '211': ('エナメルカーキ', '镜面卡其色'),
    '306': ('マットブラック', '磨砂黑色'), '307': ('マットシルバー', '磨砂银色'),
    '308': ('マットホワイト', '磨砂白色'), '310': ('マットグレー', '磨砂灰色'),
    '301': ('エナメルシルバー', '镜面银色'), 'L_khaki': ('エナメルカーキ', '镜面卡其色'),
}
SIZE_OF = {**{k: 'S' for k in ('106', '107', '108', '110', '101', '105', '109', '111', '103a')},
           **{k: 'M' for k in ('206', '207', '208', '210', '201', '211')},
           **{k: 'L' for k in ('306', '307', '308', '310', '301', 'L_khaki')}}

SPECIAL = {
    'arumi01': ('多機能アルミニウム', '多功能铝箱(前开盖铝箱)', 'S', 'シルバー', '银色'),
    'arumi02': ('多機能アルミニウム', '多功能铝箱(前开盖铝箱)', 'S', 'ブラック', '黑色'),
    'N_arumi01': ('クラシックアルミニウム', '拼接箱(全铝镁合金)', 'S', 'シルバー', '银色'),
    'N_arumi02': ('クラシックアルミニウム', '拼接箱(全铝镁合金)', 'S', 'ブラック', '黑色'),
    'outdoorsk001': ('スポーツモデル', '拼接箱26寸运动款', 'M+S', 'ブラック', '黑色'),
    'outdoorsk002': ('スポーツモデル', '拼接箱26寸运动款', 'M+S', 'シルバー', '银色'),
}
for sz, jsz in (('S', 'S'), ('M', 'M'), ('L', 'L')):
    for key, jp, cn in (('black', 'ブラック', '黑色'), ('gray', 'トグレー', '灰色'),
                        ('silver', 'シルバー', '银色'), ('white', 'ホワイト', '白色'),
                        ('turquoise', 'ターコイズ', '浅蓝色')):
        SPECIAL[f'TM_{sz}_{key}'] = ('サザンモデル', 'TM窄框款PC箱', jsz, jp, cn)

PC_NAME_JP, PC_NAME_CN = '多機能スーツケース', '多功能PC箱/前开PC箱'
CLASSIC_JP, CLASSIC_CN = '経典PC箱', '经典PC箱'


def describe(sku, order_no):
    if sku in SPECIAL:
        jp, cn, sz, cjp, ccn = SPECIAL[sku]
        return jp, cn, JP_SIZE[sz], CN_SIZE[sz], cjp, ccn
    cjp, ccn = PC_COLORS[sku]
    sz = SIZE_OF[sku]
    jp = CLASSIC_JP if order_no == 'LM20260808' else PC_NAME_JP
    cn = CLASSIC_CN if order_no == 'LM20260808' else PC_NAME_CN
    return jp, cn, JP_SIZE[sz], CN_SIZE[sz], cjp, ccn


def build_xlsx(plans, path):
    """1シート目=中文（全オーダー）、2シート目=日本語（同内容）。"""
    thin = Side(style='thin', color='B0B0B0')
    bd = Border(left=thin, right=thin, top=thin, bottom=thin)
    HF = PatternFill('solid', fgColor='1F4E78')
    HFo = Font(bold=True, color='FFFFFF', size=10)
    TF = Font(bold=True, size=14, color='1F4E78')
    SUB = Font(size=9, color='808080')
    ORD = PatternFill('solid', fgColor='4472C4')
    ORDo = Font(bold=True, color='FFFFFF', size=12)
    SHIP = PatternFill('solid', fgColor='DDEBF7')
    TOT = PatternFill('solid', fgColor='F8CBAD')
    SUMF = PatternFill('solid', fgColor='E2EFDA')
    SPARE = PatternFill('solid', fgColor='FFF2CC')
    C = Alignment(horizontal='center', vertical='center')
    LN = Alignment(horizontal='left', vertical='center')
    WRAP = Alignment(horizontal='center', vertical='center', wrap_text=True)

    T = {
        'cn': dict(
            sheet='中文', title='生产计划一览表（全部订单）',
            note1='余数为每个颜色的合计，只写在该颜色最后一班的行（「－」表示不适用）。',
            note2='尺寸对应: S=20寸 / M=24寸 / L=28寸 / M+S=26寸',
            sum_title='■ 订单汇总',
            sum_hdr=['订单号', '内容', '数量', '出货', '余数', '班次', '首班', '末班', '交期'],
            hdr=['班次', '订单号', '品名', '尺寸', '颜色', '数量', '出货日', '余数'],
            ship='出货时间', unit='个', total='合计', gtotal='总合计',
            order_line='数量 {q:,}个 ／ 出货 {s:,}个 ／ 余数 {sp:,}个　　交期: {d}',
        ),
        'jp': dict(
            sheet='日本語', title='生産計画 一覧表（全オーダー）',
            note1='余りは色ごとの合計です。その色の最終便の行にのみ記載しています（「－」は記載なし）。',
            note2='サイズ対応: S=20寸 / M=24寸 / L=28寸 / M+S=26寸',
            sum_title='■ オーダー別サマリー',
            sum_hdr=['注文番号', '内容', '数量', '出荷', '余り', '便数', '初回出荷', '最終出荷', '納期'],
            hdr=['便No.', '注文番号', '商品名', 'サイズ', 'カラー', '数量', '出荷日', '余り'],
            ship='出荷日', unit='個', total='合計', gtotal='総合計',
            order_line='数量 {q:,}個 ／ 出荷 {s:,}個 ／ 余り {sp:,}個　　納期: {d}',
        ),
    }

    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    for lang in ('cn', 'jp'):
        t = T[lang]
        ws = wb.create_sheet(t['sheet'])
        ws['A1'] = t['title']; ws['A1'].font = TF
        ws['A2'] = t['note1']; ws['A2'].font = SUB
        ws['A3'] = t['note2']; ws['A3'].font = SUB

        # --- サマリー ---
        ws['A5'] = t['sum_title']; ws['A5'].font = Font(bold=True, size=12, color='1F4E78')
        for c, x in enumerate(t['sum_hdr'], 1):
            y = ws.cell(6, c, x); y.fill = HF; y.font = HFo; y.border = bd; y.alignment = WRAP
        r = 7
        TQ = TS = TSP = TN = 0
        for pl in plans:
            tq = sum(pl['order_qty'].values())
            ts = sum(sh['qty'] for sh in pl['shipments'])
            tsp = sum(pl['spare_by_sku'].values())
            ships = [sh['ship'] for sh in pl['shipments']]
            lab = pl['label_cn'] if lang == 'cn' else pl['label']
            dl = pl['deadline_cn'] if lang == 'cn' else pl['deadline']
            for c, v in enumerate([pl['order_no'], lab, tq, ts, tsp,
                                   len(ships), ships[0], ships[-1], dl], 1):
                y = ws.cell(r, c, v); y.border = bd; y.fill = SUMF
                y.alignment = LN if c in (2, 9) else C
                if c == 5 and v:
                    y.fill = SPARE; y.font = Font(bold=True)
            TQ += tq; TS += ts; TSP += tsp; TN += len(ships); r += 1
        ws.cell(r, 2, t['gtotal'])
        ws.cell(r, 3, TQ); ws.cell(r, 4, TS); ws.cell(r, 5, TSP); ws.cell(r, 6, TN)
        for c in range(1, 10):
            y = ws.cell(r, c); y.fill = TOT; y.font = Font(bold=True, size=11)
            y.border = bd; y.alignment = C if c != 2 else LN
        r += 2

        # --- 明細（全オーダー） ---
        hr = r
        for c, x in enumerate(t['hdr'], 1):
            y = ws.cell(hr, c, x); y.fill = HF; y.font = HFo; y.border = bd; y.alignment = WRAP
        r = hr + 1
        ncol = len(t['hdr'])
        for pl in plans:
            no = pl['order_no']
            oq, spare = pl['order_qty'], pl['spare_by_sku']
            last = {}
            for sh in pl['shipments']:
                for sku in sh['items']:
                    last[sku] = sh['ship']
            tq = sum(oq.values())
            ts = sum(sh['qty'] for sh in pl['shipments'])
            tsp = sum(spare.values())
            lab = pl['label_cn'] if lang == 'cn' else pl['label']
            dl = pl['deadline_cn'] if lang == 'cn' else pl['deadline']
            ws.cell(r, 1, f"【{no}】{lab}　　"
                          + t['order_line'].format(q=tq, s=ts, sp=tsp, d=dl))
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=ncol)
            for c in range(1, ncol + 1):
                y = ws.cell(r, c); y.fill = ORD; y.font = ORDo; y.alignment = LN
            ws.row_dimensions[r].height = 20
            r += 1
            for sh in pl['shipments']:
                ws.cell(r, 1, f"No.{sh['no']}　{t['ship']} {sh['ship']}　{sh['qty']:,}{t['unit']}")
                ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=ncol)
                for c in range(1, ncol + 1):
                    y = ws.cell(r, c); y.fill = SHIP; y.font = Font(bold=True); y.alignment = LN
                r += 1
                for sku, q in sh['items'].items():
                    jp, cn, jsz, csz, cjp, ccn = describe(sku, no)
                    sp = spare.get(sku, 0) if last[sku] == sh['ship'] else '－'
                    name, size, color = (cn, csz, ccn) if lang == 'cn' else (jp, jsz, cjp)
                    for c, v in enumerate([f"No.{sh['no']}", no, name, size, color,
                                           q, sh['ship'], sp], 1):
                        y = ws.cell(r, c, v); y.border = bd
                        y.alignment = LN if c == 3 else C
                        if c == 8 and isinstance(v, int) and v > 0:
                            y.fill = SPARE; y.font = Font(bold=True)
                    r += 1
            ws.cell(r, 3, t['total']); ws.cell(r, 6, ts); ws.cell(r, 8, tsp)
            for c in range(1, ncol + 1):
                y = ws.cell(r, c); y.fill = TOT; y.font = Font(bold=True); y.border = bd
                y.alignment = C if c != 3 else LN
            r += 2   # オーダー間に空白行

        for i, w in enumerate([10, 16, 28, 9, 20, 9, 13, 9], 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.column_dimensions['B'].width = 16
        ws.freeze_panes = ws.cell(hr + 1, 1)

    wb.save(path)


def main():
    with open(os.path.join(DATA, 'production-plans.json'), encoding='utf-8') as f:
        plans = json.load(f)['plans']
    lines = []
    lines.append('生産計画 日中対照表 / 生产计划 中日对照表')
    lines.append('書式 / 格式: 注文番号 商品名:サイズ:カラー:数量:出荷日:余り')
    lines.append('　　　　　　  订单号　 品名:尺寸:颜色:数量:出货日:余数')
    lines.append('※余りは色ごとの合計です。その色の最終便の行にのみ記載し、他は「－」としています。')
    lines.append('※余数为每个颜色的合计。只写在该颜色最后一班的行，其他行为「－」。')
    lines.append('')

    for pl in plans:
        no = pl['order_no']
        oq = pl['order_qty']
        spare = pl['spare_by_sku']
        # 色ごとの最終便を判定
        last = {}
        for sh in pl['shipments']:
            for sku in sh['items']:
                last[sku] = sh['ship']
        tot_q = sum(oq.values())
        tot_s = sum(sh['qty'] for sh in pl['shipments'])
        tot_sp = sum(spare.values())

        lines.append('=' * 62)
        lines.append(f"【{no}】{pl['label']}")
        lines.append(f"　数量合計 {tot_q:,}個 ／ 出荷合計 {tot_s:,}個 ／ 余り合計 {tot_sp:,}個")
        lines.append(f"　数量合计 {tot_q:,}个 ／ 出货合计 {tot_s:,}个 ／ 余数合计 {tot_sp:,}个")
        lines.append(f"　納期 / 交期: {pl['deadline']}")
        lines.append('')

        lines.append('■ 日本語')
        for sh in pl['shipments']:
            lines.append(f"  〔No.{sh['no']}　出荷日 {sh['ship']}　{sh['qty']:,}個〕")
            for sku, q in sh['items'].items():
                jp, _cn, jsz, _csz, cjp, _ccn = describe(sku, no)
                sp = f"{spare.get(sku, 0)}" if last[sku] == sh['ship'] else '－'
                lines.append(f"  {no} {jp}:{jsz}:{cjp}:{q}:{sh['ship']}:{sp}")
            lines.append('')

        lines.append('■ 中文')
        for sh in pl['shipments']:
            lines.append(f"  〔No.{sh['no']}　出货时间 {sh['ship']}　{sh['qty']:,}个〕")
            for sku, q in sh['items'].items():
                _jp, cn, _jsz, csz, _cjp, ccn = describe(sku, no)
                sp = f"{spare.get(sku, 0)}" if last[sku] == sh['ship'] else '－'
                lines.append(f"  {no} {cn}:{csz}:{ccn}:{q}:{sh['ship']}:{sp}")
            lines.append('')
        lines.append('')

    total_q = sum(sum(p['order_qty'].values()) for p in plans)
    total_s = sum(sh['qty'] for p in plans for sh in p['shipments'])
    total_sp = sum(sum(p['spare_by_sku'].values()) for p in plans)
    lines.append('=' * 62)
    lines.append(f"【総合計 / 总合计】数量 {total_q:,}個 ／ 出荷 {total_s:,}個 ／ 余り {total_sp:,}個")

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, '生産計画_日中対照.txt')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('saved', path)
    xlsx = os.path.join(OUT, '生産計画_日中対照.xlsx')
    build_xlsx(plans, xlsx)
    print('saved', xlsx)
    print(f'総合計 数量{total_q:,} / 出荷{total_s:,} / 余り{total_sp:,}')


if __name__ == '__main__':
    main()
