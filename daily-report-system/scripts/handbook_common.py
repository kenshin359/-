#!/usr/bin/env python3
# ============================================================
#  研修ハンドブック（PDF）の共通部品
# ------------------------------------------------------------
#  トレーナー研修／新人研修／管理職育成の3冊で、同じ見た目を使うための部品です。
#  配色・フォントの制約は scripts/pdf_common.py と同じ考え方に揃えています。
#   ・日本語の太字フォントが無い → <b> は「色」に変換して強調する
#   ・IPAゴシックに ☐ は無い（□ U+25A1 は有る）→ チェック欄は □ を使う
#     ※ pdf_common.check_glyphs() で、入っていない文字を機械的に確認できます
# ============================================================
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph,
    Spacer, Table, TableStyle,
)

FONTS = ('/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf',
         '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
         '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')

INK = colors.HexColor('#1a1a19')
INK2 = colors.HexColor('#52514e')
MUTED = colors.HexColor('#898781')
ACCENT = colors.HexColor('#2a78d6')
WARN = colors.HexColor('#d03b3b')
OK = colors.HexColor('#1f7a4d')
LINE = colors.HexColor('#d8d7d0')
BAND = colors.HexColor('#f1f1ed')
HEAD_BG = colors.HexColor('#3d3d3a')
EMPH = '#123c78'          # 太字が無いため、強調はこの色で表す

W = 165 * mm              # 本文の幅
BOX = '□'                 # ☐ はフォントに無いので □ を使う

S = {}


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a[len(name) + 3:]
    return default


def init():
    """フォントを登録して、文字スタイルを用意する。各スクリプトの最初に呼ぶ。"""
    path = next((p for p in FONTS if os.path.exists(p)), None)
    if not path:
        sys.exit('日本語フォントが見つかりません（fonts-ipafont-gothic を入れてください）')
    pdfmetrics.registerFont(TTFont('JP', path))
    base = dict(fontName='JP', textColor=INK, leading=15.5)
    S.update({
        'title': ParagraphStyle('t', **{**base, 'fontSize': 22, 'leading': 29, 'spaceAfter': 4}),
        'subtitle': ParagraphStyle('st', **{**base, 'fontSize': 11, 'leading': 17, 'textColor': INK2}),
        'lead': ParagraphStyle('ld', **{**base, 'fontSize': 12, 'leading': 18,
                                        'textColor': colors.HexColor(EMPH)}),
        'h1': ParagraphStyle('h1', **{**base, 'fontSize': 15.5, 'leading': 20,
                                      'spaceBefore': 8, 'spaceAfter': 2}),
        'h2': ParagraphStyle('h2', **{**base, 'fontSize': 11, 'leading': 15,
                                      'spaceBefore': 6, 'spaceAfter': 2}),
        'body': ParagraphStyle('b', **{**base, 'fontSize': 9.2, 'leading': 13.8,
                                       'spaceAfter': 3, 'alignment': TA_LEFT}),
        'small': ParagraphStyle('s', **{**base, 'fontSize': 8.8, 'leading': 13.5, 'textColor': INK2}),
        'note': ParagraphStyle('n', **{**base, 'fontSize': 8.5, 'leading': 13, 'textColor': MUTED}),
        'cell': ParagraphStyle('c', **{**base, 'fontSize': 8.5, 'leading': 12.2}),
        'cellh': ParagraphStyle('ch', **{**base, 'fontSize': 8.5, 'leading': 12.2,
                                         'textColor': colors.white}),
        'center': ParagraphStyle('ct', **{**base, 'fontSize': 8.5, 'leading': 12.2,
                                          'alignment': TA_CENTER}),
        'big': ParagraphStyle('bg', **{**base, 'fontSize': 10.5, 'leading': 16}),
    })
    return S


def emph(text):
    return str(text).replace('<b>', f'<font color="{EMPH}">').replace('</b>', '</font>')


def P(text, kind='body'):
    return Paragraph(emph(text), S[kind])


def table(rows, widths, header=True, zebra=True, row_h=None, align=None):
    """1行目を見出しにする表。align は中央ぞろえにする列番号のリスト。"""
    data = [[Paragraph(emph(c), S['cellh'] if (header and i == 0) else S['cell']) for c in row]
            for i, row in enumerate(rows)]
    heights = None
    if row_h:
        heights = ([None] + [row_h] * (len(data) - 1)) if header else [row_h] * len(data)
    t = Table(data, colWidths=widths, rowHeights=heights, repeatRows=1 if header else 0)
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 2.8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.8),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINE),
    ]
    if header:
        cmds.append(('BACKGROUND', (0, 0), (-1, 0), HEAD_BG))
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if i % 2 == (1 if header else 0):
                cmds.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#fafaf7')))
    for col in (align or []):
        cmds.append(('ALIGN', (col, 0), (col, -1), 'CENTER'))
    t.setStyle(TableStyle(cmds))
    return t


def callout(title, body, color=ACCENT):
    """色帯つきの囲み。途中でページが割れないようにまとめて置く。"""
    inner = [[Paragraph(f'<font color="{EMPH}">{title}</font>', S['cell'])],
             [Paragraph(emph(body), S['cell'])]]
    t = Table(inner, colWidths=[W])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BAND),
        ('LINEBEFORE', (0, 0), (0, -1), 2.5, color),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (0, 0), 7),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 7),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return KeepTogether([t])


def band_label(text, color=INK2):
    t = Table([[Paragraph(f'<font color="{EMPH}">{text}</font>', S['cell'])]], colWidths=[W])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BAND),
        ('LINEBEFORE', (0, 0), (0, -1), 2.2, color),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    return t


def bullets(items, mark='・'):
    rows = [[Paragraph(emph(f'{mark}　{it}'), S['cell'])] for it in items]
    t = Table(rows, colWidths=[W])
    t.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 1.6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 1.6),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return t


def numbered(items):
    rows = [[Paragraph(f'{i}.', S['center']), Paragraph(emph(it), S['cell'])]
            for i, it in enumerate(items, 1)]
    t = Table(rows, colWidths=[8 * mm, W - 8 * mm])
    t.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -2), 0.3, LINE),
    ]))
    return t


def checkboxes(items, judge=False, judge_label='◯×'):
    """□つきの一覧。judge=True なら右に◯×の記入欄を付ける。"""
    if not judge:
        return bullets(items, mark=BOX)
    rows = [[Paragraph('', S['cell']),
             Paragraph(f'<font color="{EMPH}">{judge_label}</font>', S['center'])]]
    rows += [[Paragraph(emph(f'{BOX}　{it}'), S['cell']), Paragraph('', S['cell'])] for it in items]
    t = Table(rows, colWidths=[W - 24 * mm, 24 * mm])
    t.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 2.2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.2),
        ('LINEBELOW', (0, 1), (-1, -1), 0.3, LINE),
        ('BOX', (1, 0), (1, -1), 0.4, LINE),
        ('BACKGROUND', (1, 0), (1, 0), BAND),
    ]))
    return t


def write_lines(n=3, label='', label_w=34 * mm, height=8 * mm):
    """手で書き込むための空欄。"""
    rows = [[Paragraph(label if i == 0 else '', S['cell']), Paragraph('', S['cell'])]
            for i in range(n)]
    t = Table(rows, colWidths=[label_w, W - label_w], rowHeights=[height] * n)
    t.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINE),
        ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
    ]))
    return t


def words_table(rows, head=('むずかしい言葉', 'かんたんに言うと', 'たとえると')):
    """難しい言葉に、やさしい説明と たとえ を付けた表。"""
    body = [[a, b, c] for a, b, c in rows]
    return table([list(head)] + body, [34 * mm, (W - 34 * mm) * 0.52, (W - 34 * mm) * 0.48])


def terms_table(rows, head=('用語', '意味')):
    """用語と意味だけの表（2列）。"""
    return table([list(head)] + [[a, b] for a, b in rows], [42 * mm, W - 42 * mm])


def trouble_table(rows, head=('こんなとき（つまずきやすい）', 'こうする')):
    return table([list(head)] + [[a, b] for a, b in rows], [W * 0.42, W * 0.58])


def make_doc(out_path, title, running_head, author='O2ジム'):
    from datetime import date
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
        canvas.drawRightString(190 * mm, 287 * mm, date.today().isoformat())
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.4)
        canvas.line(20 * mm, 285 * mm, 190 * mm, 285 * mm)
        canvas.drawCentredString(105 * mm, 12 * mm, f'— {d.page} —')
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id='p', frames=[
        Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')],
        onPage=header_footer)])
    return doc


def cover(F, meta, chapters=None, per_row=2):
    """表紙＋目次。chapters を渡すと目次を2列で並べる。"""
    F.append(Spacer(1, 6 * mm))
    F.append(P(meta['title'], 'title'))
    F.append(P(meta['subtitle'], 'subtitle'))
    F.append(Spacer(1, 3 * mm))
    F.append(P(meta['lead'], 'lead'))
    F.append(P(meta['target'], 'small'))
    F.append(Spacer(1, 5 * mm))
    if chapters:
        F.append(P(f'目次（全{len(chapters)}章）', 'h2'))
        rows = []
        for i in range(0, len(chapters), per_row):
            pair = chapters[i:i + per_row]
            cells = [f'<b>{c["no"]} {c["title"]}</b><br/>{c["lead"]}' for c in pair]
            cells += [''] * (per_row - len(cells))
            rows.append(cells)
        F.append(table(rows, [W / per_row] * per_row, header=False, zebra=False))


# 章の中の見出し。本によって言い回しを変える（中身の順番は変えない）。
LABELS_STANDARD = {
    'goal': '1. ゴール',
    'words': '2. 用語・前提',
    'steps': '3. 手順（この順で進める）',
    'fixed': '4. 必ず守る社内ルール（固定）',
    'guides': '5. 運用の目安（状況で変更可）',
    'checks': '6. チェックリスト（研修担当が◯×判定）',
    'solo': '7. 独り立ち判定（3つ全て）',
    'trouble': 'つまずいたら',
    'cont': 'ここからは「守ること」と「判定」です。',
}
LABELS_EASY = {
    'goal': '1. ゴール（これができたら合格）',
    'words': '2. むずかしい言葉（先に読む）',
    'steps': '3. 手順（この順でやる）',
    'fixed': '4. 必ず守ること（変えてはいけない）',
    'guides': '5. 目安（状況で変えてよい）',
    'checks': '6. チェックリスト（研修担当が◯×をつける）',
    'solo': '7. 合格の判定（3つ全部で合格）',
    'trouble': 'つまずいたら',
    'cont': 'ここからは「守ること」と「合格の判定」です。',
}


def chapter(F, c, page_break=True, split=False, labels=None):
    """
    1章ぶん。7つのパートは全章で共通（順番も固定）。
    split=True のときは、前半（学ぶ）と後半（守る・判定）を2ページに分ける。
    中身が多い本で、1ページ目だけ詰まって2ページ目が数行になるのを防ぐため。
    """
    L = labels or LABELS_EASY
    words = c.get('words') or c.get('terms')
    head = [P(f'第{c["no"]}章　{c["title"]}', 'h1'), P(c['lead'], 'small')]
    if c.get('oneline'):
        head += [Spacer(1, 1.5 * mm), callout('ひとことで言うと', c['oneline'])]
    head += [Spacer(1, 1.5 * mm), P(L['goal'], 'h2'), P(c['goal'])]
    F.append(KeepTogether(head))

    # 用語の説明は2列（用語・意味）でも3列（＋たとえ）でもよい
    wt = words_table(words) if len(words[0]) == 3 else terms_table(words)
    F.append(KeepTogether([P(L['words'], 'h2'), wt]))
    F.append(KeepTogether([P(L['steps'], 'h2'), numbered(c['steps'])]))

    if split and c.get('trouble'):
        F.append(Spacer(1, 1.5 * mm))
        F.append(KeepTogether([P(L['trouble'], 'h2'), trouble_table(c['trouble'])]))
        F.append(PageBreak())
        F.append(P(f'第{c["no"]}章　{c["title"]}（つづき）', 'h1'))
        F.append(P(L['cont'], 'small'))
        F.append(Spacer(1, 1.5 * mm))

    F.append(Spacer(1, 1.5 * mm))
    F.append(KeepTogether([band_label(L['fixed'], WARN),
                           Spacer(1, 1 * mm), bullets(c['fixed'])]))
    F.append(Spacer(1, 1.5 * mm))
    F.append(KeepTogether([band_label(L['guides'], ACCENT),
                           Spacer(1, 1 * mm), bullets(c['guides'])]))

    F.append(P(L['checks'], 'h2'))
    F.append(checkboxes(c['checks'], judge=True))

    F.append(Spacer(1, 1.5 * mm))
    F.append(KeepTogether([band_label(L['solo'], OK),
                           Spacer(1, 1 * mm), bullets(c['solo'], mark=BOX)]))

    if c.get('trouble') and not split:
        F.append(Spacer(1, 1.5 * mm))
        F.append(KeepTogether([P(L['trouble'], 'h2'), trouble_table(c['trouble'])]))
    if c.get('homework'):
        F.append(Spacer(1, 1.5 * mm))
        F.append(KeepTogether([
            P('宿題（次に会うまでに、実際にやってみる）', 'h2'),
            checkboxes(c['homework'], judge=True, judge_label='できた'),
            Spacer(1, 1 * mm),
            write_lines(2, 'やってみて気づいたこと')]))
    if page_break:
        F.append(PageBreak())
