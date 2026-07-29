#!/usr/bin/env python3
# ============================================================
#  PDF資料の共通部品
# ------------------------------------------------------------
#  社内資料のPDFを作るときの、フォント・配色・表・囲みをまとめています。
#
#  この環境の制約に合わせた作りになっています:
#   ・日本語フォントは IPAゴシック（Regular のみ・太字が無い）
#     → <b> は効かないので、強調は「色」で表現する
#   ・IPAゴシックに ☐ や ⚠️ は入っていない
#     → 使うと空白になるため、収録済みの文字だけを使う
#       （check_glyphs() で機械的に確認できます）
# ============================================================
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageTemplate, Paragraph, Table, TableStyle,
)

FONT_REG = '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf'
FONT_ALT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'

INK = colors.HexColor('#1a1a19')
INK2 = colors.HexColor('#52514e')
MUTED = colors.HexColor('#898781')
ACCENT = colors.HexColor('#2a78d6')
GOOD = colors.HexColor('#0b6b0b')
WARN = colors.HexColor('#d03b3b')
LINE = colors.HexColor('#d8d7d0')
BAND = colors.HexColor('#f1f1ed')
HEAD_BG = colors.HexColor('#3d3d3a')

# 太字が無いため、強調は色で表す（印刷しても濃さの差として残る色を選んでいる）
EMPH = '#123c78'

CONTENT_W = 165 * mm

_S = {}


def register_fonts():
    path = FONT_REG if os.path.exists(FONT_REG) else FONT_ALT
    pdfmetrics.registerFont(TTFont('JP', path))
    return path


def styles():
    global _S
    base = dict(fontName='JP', textColor=INK, leading=15.5)
    _S = {
        'title': ParagraphStyle('t', **{**base, 'fontSize': 21, 'leading': 28, 'spaceAfter': 4}),
        'subtitle': ParagraphStyle('st', **{**base, 'fontSize': 10.5, 'leading': 16, 'textColor': INK2}),
        'h1': ParagraphStyle('h1', **{**base, 'fontSize': 15, 'leading': 21, 'spaceBefore': 14, 'spaceAfter': 7}),
        'h2': ParagraphStyle('h2', **{**base, 'fontSize': 11.5, 'leading': 17, 'spaceBefore': 10, 'spaceAfter': 4}),
        'body': ParagraphStyle('b', **{**base, 'fontSize': 9.5, 'leading': 15.5, 'spaceAfter': 5, 'alignment': TA_LEFT}),
        'small': ParagraphStyle('s', **{**base, 'fontSize': 8.5, 'leading': 13, 'textColor': INK2}),
        'note': ParagraphStyle('n', **{**base, 'fontSize': 8.5, 'leading': 13, 'textColor': MUTED}),
        'quote': ParagraphStyle('q', **{**base, 'fontSize': 9, 'leading': 14.5, 'textColor': INK2,
                                        'leftIndent': 8, 'spaceAfter': 4}),
        'cell': ParagraphStyle('c', **{**base, 'fontSize': 8.8, 'leading': 13.5}),
        'cellh': ParagraphStyle('ch', **{**base, 'fontSize': 8.8, 'leading': 13.5, 'textColor': colors.white}),
        'big': ParagraphStyle('bg', **{**base, 'fontSize': 26, 'leading': 30}),
    }
    return _S


def emph(text):
    """<b>〜</b> を色付きに変換する（日本語の太字フォントが無いため）"""
    return str(text).replace('<b>', f'<font color="{EMPH}">').replace('</b>', '</font>')


def P(text, kind='body'):
    return Paragraph(emph(text), _S[kind])


def table(rows, widths, header=True, zebra=True, row_h=None, align=None):
    data = [[Paragraph(emph(c), _S['cellh'] if (header and i == 0) else _S['cell']) for c in row]
            for i, row in enumerate(rows)]
    heights = None
    if row_h:
        heights = ([None] + [row_h] * (len(data) - 1)) if header else [row_h] * len(data)

    t = Table(data, colWidths=widths, rowHeights=heights, repeatRows=1 if header else 0)
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINE),
    ]
    if header:
        cmds.append(('BACKGROUND', (0, 0), (-1, 0), HEAD_BG))
    if zebra:
        start = 1 if header else 0
        for i in range(start, len(data)):
            if (i - start) % 2 == 1:
                cmds.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#fafaf7')))
    if align:
        for col, a in align.items():
            cmds.append(('ALIGN', (col, 0), (col, -1), a))
    t.setStyle(TableStyle(cmds))
    return t


def callout(title, body, color=ACCENT):
    inner = [[Paragraph(f'<font color="{EMPH}">{title}</font>', _S['cell'])],
             [Paragraph(emph(body), _S['cell'])]]
    t = Table(inner, colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BAND),
        ('LINEBEFORE', (0, 0), (0, -1), 2.5, color),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (0, 0), 7),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 7),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    # 囲みが途中で2ページに割れると読みにくいので、1ページに収める
    return KeepTogether([t])


def kpi_row(items):
    """数字を並べたカード列。items = [(見出し, 値, 補足), ...]"""
    cells = []
    for label, value, note in items:
        inner = Table(
            [[Paragraph(label, _S['small'])],
             [Paragraph(f'<font color="{EMPH}">{value}</font>', _S['big'])],
             [Paragraph(note or '', _S['note'])]],
            colWidths=[CONTENT_W / len(items) - 4 * mm],
        )
        inner.setStyle(TableStyle([
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        cells.append(inner)

    t = Table([cells], colWidths=[CONTENT_W / len(items)] * len(items))
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BAND),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    return t


def bar_table(rows, max_value, width_mm=60):
    """
    横棒つきの表。rows = [(名前, 値, 表示文字列), ...]

    ★棒は「色を塗ったセル」で描く。
      █ のような文字で描く方法は、IPAゴシックに U+2588 が
      収録されておらずPDF上で消えてしまうため使わない。
    """
    from reportlab.lib.colors import HexColor
    bar_w = width_mm * mm

    data = [[Paragraph('項目', _S['cellh']), Paragraph('割合', _S['cellh']),
             Paragraph('値', _S['cellh'])]]
    styles_extra = []
    for idx, (name, value, shown) in enumerate(rows, start=1):
        ratio = (value / max_value) if max_value else 0
        filled = max(2.0, min(bar_w, bar_w * ratio))
        # 塗ったセル＋余白セルの2列で棒を表す
        inner = Table([['', '']], colWidths=[filled, max(0.1, bar_w - filled)], rowHeights=[4.2 * mm])
        inner.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), HexColor(EMPH)),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        data.append([Paragraph(emph(name), _S['cell']), inner, Paragraph(shown, _S['cell'])])

    t = Table(data, colWidths=[52 * mm, bar_w, CONTENT_W - 52 * mm - bar_w])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEAD_BG),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINE),
    ] + styles_extra))
    return t


def make_doc(out_path, title, running_head, author='株式会社リベティ'):
    doc = BaseDocTemplate(
        out_path, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=24 * mm, bottomMargin=20 * mm,
        title=title, author=author,
    )

    def header_footer(canvas, d):
        canvas.saveState()
        canvas.setFont('JP', 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 287 * mm, running_head)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.4)
        canvas.line(20 * mm, 285 * mm, 190 * mm, 285 * mm)
        canvas.drawCentredString(105 * mm, 12 * mm, f'— {d.page} —')
        canvas.restoreState()

    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=header_footer)])
    return doc


def check_glyphs(text):
    """
    フォントに無い文字が混ざっていないかを確認する。
    IPAゴシックには ☐ や ⚠️ が無く、PDFでは空白になってしまうため。
    """
    try:
        from fontTools.ttLib import TTFont as FT
    except ImportError:
        return []
    path = FONT_REG if os.path.exists(FONT_REG) else FONT_ALT
    cmap = set()
    for tb in FT(path)['cmap'].tables:
        cmap |= set(tb.cmap.keys())
    return sorted({c for c in str(text) if ord(c) > 0x7f and ord(c) not in cmap})
