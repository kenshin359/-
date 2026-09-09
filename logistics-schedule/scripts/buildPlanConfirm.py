#!/usr/bin/env python3
"""生産計画の日中対照表（日本↔中国の認識合わせ用）を出力する。

  python3 scripts/buildPlanConfirm.py
  → out/生産計画_日中対照.txt

書式（1行＝1色×1便）:
  注文番号 商品名:サイズ:カラー:数量:出荷日:余り

余りは色ごとの合計なので、その色の最終便の行にだけ数字を入れ、
それ以外の行は「－」とする（二重計上を避けるため）。
"""
import json, os
from collections import OrderedDict

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
    print(f'総合計 数量{total_q:,} / 出荷{total_s:,} / 余り{total_sp:,}')


if __name__ == '__main__':
    main()
