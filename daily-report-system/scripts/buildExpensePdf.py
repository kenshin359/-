#!/usr/bin/env python3
# ============================================================
#  経費レポートPDF（月1回・締め期間ごと）
# ------------------------------------------------------------
#  scripts/expenseReport.js が書いた out/expense-report.json を読み、
#  ・サマリー（合計・件数・支払方法別）
#  ・利用者別の合計（横棒つき）
#  ・費目別の合計
#  ・利用者ごとの明細
#  をA4のPDFにまとめます。
#
#  実行: python3 scripts/buildExpensePdf.py [入力JSON] [出力PDF]
#        （省略時 out/expense-report.json → out/expense-report.pdf）
# ============================================================
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, Spacer

import pdf_common as pc

CONTENT_W = pc.CONTENT_W


def yen(n):
    return f'{int(round(n)):,}円'


def receipt_image(path, max_w=78 * mm, max_h=110 * mm):
    """明細画像を縦横比を保って縮小して返す（読めない形式は None）"""
    try:
        iw, ih = ImageReader(path).getSize()
        scale = min(max_w / iw, max_h / ih, 1.0)
        return Image(path, width=iw * scale, height=ih * scale)
    except Exception:
        return None


def main():
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out')
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base, 'expense-report.json')
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(base, 'expense-report.pdf')

    with open(src, encoding='utf-8') as f:
        data = json.load(f)

    pc.register_fonts()
    pc.styles()

    period = data['period']
    title = '経費レポート'
    doc = pc.make_doc(dst, title, f'経費レポート  {period["label"]}')

    story = [
        pc.P(title, 'title'),
        pc.P(f'対象期間: {period["label"]}　（キントーン「経費管理」アプリより自動集計）', 'subtitle'),
        Spacer(1, 6 * mm),
    ]

    # ── サマリー ──
    method_note = ' ／ '.join(f'{k} {yen(v)}' for k, v in data['byMethod']) or '—'
    story.append(pc.kpi_row([
        ('経費合計', yen(data['total']), method_note),
        ('件数', f'{data["count"]}件', f'利用者 {len(data["byMember"])}名'),
    ]))
    story.append(Spacer(1, 6 * mm))

    # ── 利用者別 ──
    story.append(pc.P('利用者別の合計', 'h1'))
    if data['byMember']:
        max_v = max(v for _, v in data['byMember'])
        story.append(pc.bar_table(
            [(name, v, yen(v)) for name, v in data['byMember']], max_v))
    else:
        story.append(pc.P('対象期間の経費はありません。'))
    story.append(Spacer(1, 4 * mm))

    # ── 費目別 ──
    story.append(pc.P('費目別の合計', 'h1'))
    if data['byCategory']:
        rows = [['費目', '金額', '構成比']]
        for name, v in data['byCategory']:
            share = f'{v / data["total"] * 100:.1f}%' if data['total'] else '-'
            rows.append([name, yen(v), share])
        story.append(pc.table(rows, [70 * mm, 50 * mm, CONTENT_W - 120 * mm],
                              align={1: 'RIGHT', 2: 'RIGHT'}))
    else:
        story.append(pc.P('対象期間の経費はありません。'))
    story.append(Spacer(1, 4 * mm))

    # ── 利用者ごとの明細 ──
    story.append(pc.P('利用者ごとの明細', 'h1'))
    rows_by_member = {}
    for r in data['rows']:
        rows_by_member.setdefault(r['member'], []).append(r)

    for member, _total in data['byMember']:
        items = rows_by_member.get(member, [])
        story.append(pc.P(f'<b>{member}</b>　{yen(_total)}（{len(items)}件）', 'h2'))
        rows = [['利用日', '支払方法', '費目', '支払先', '内容', '金額']]
        for r in items:
            rows.append([
                r['date'], r['method'], r['category'],
                r['payee'] or '-', (r['detail'] or '-').replace('\n', ' '), yen(r['amount']),
            ])
        story.append(pc.table(
            rows,
            [20 * mm, 21 * mm, 27 * mm, 32 * mm, CONTENT_W - 124 * mm, 24 * mm],
            align={5: 'RIGHT'},
        ))
        story.append(Spacer(1, 3 * mm))

        # 明細画像（レコードに添付された領収書・カード明細のスクショ）
        for r in items:
            for f in r.get('images', []):
                img = receipt_image(f['path'])
                caption = f'{r["date"]}　{yen(r["amount"])}　{f.get("name", "")}'
                if img is not None:
                    story.append(pc.P(caption, 'small'))
                    story.append(img)
                    story.append(Spacer(1, 3 * mm))
                else:
                    story.append(pc.P(f'{caption}　（この形式はPDFに表示できません。'
                                      'キントーンのレコードで確認してください）', 'note'))
        story.append(Spacer(1, 2 * mm))

    story.append(Spacer(1, 4 * mm))
    story.append(pc.P('このPDFは毎月自動作成されています。明細の追加・修正はキントーンの'
                      '「経費管理」アプリで行ってください。', 'note'))

    doc.build(story)
    print(f'書き出し: {dst}')


if __name__ == '__main__':
    main()
