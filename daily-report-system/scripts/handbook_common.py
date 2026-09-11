#!/usr/bin/env python3
# ============================================================
#  研修ハンドブック（PDF）の共通部品
# ------------------------------------------------------------
#  トレーナー研修／新人研修／管理職育成の3冊で、同じ見た目を使うための部品です。
#
#  ◆ 文字（フォント）について
#    本物の太字（Noto Sans CJK JP Bold）があればそれを使います。
#    無い／読めないときは IPAゴシックに戻し、見出しなどの太字は
#    「輪郭を重ね描きする擬似太字」で表します（Bold クラス）。
#    どちらに転んでも組版は崩れません。失敗した理由は必ず標準エラーに出します。
#      ※ ReportLab は PostScript（CFF）系の .ttc/.otf を埋め込めません。
#        Noto Sans CJK の .ttc はこの形式なので、この環境では
#        自動的に IPAゴシック＋擬似太字になります。
#
#  ◆ 記号について
#    IPAゴシックに ☐ は無い（□ U+25A1 は有る）→ チェック欄は □ を使う
#    ※ check_glyphs() で、入っていない文字を機械的に確認できます
#
#  ◆ 色のきまり（意味と色を1対1に固定する）
#    固定ルール＝赤系 / 運用の目安＝青系 / 合格・独り立ち＝緑系
#    モノクロ印刷でも区別できるよう、色だけに頼らず
#    「地色の濃さ」「枠線の有無」「罫の太さ」でも冗長化しています。
# ============================================================
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

# ───────── フォントの置き場所 ─────────
NOTO_REGULAR = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
NOTO_BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
NOTO_INDEX = 0                     # .ttc の中の「Noto Sans CJK JP」の位置
IPA_FONTS = ('/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf',
             '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
             '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
FONTS = IPA_FONTS                  # 以前の名前（外から参照されている場合のため）

FONT = 'JP'                        # 本文の書体名
FONT_B = 'JP'                      # 太字の書体名（無ければ本文と同じ）
HAS_BOLD = False                   # 本物の太字が使えるか
FONT_FILE = None                   # 実際に使った本文フォントのパス
BOLD_STROKE = 0.042                # 擬似太字の輪郭の太さ（文字サイズに対する比）

# ───────── 配色 ─────────
#  企業研修テキストとして落ち着かせるため、彩度を下げた濃色でそろえています。
INK = colors.HexColor('#1f2229')        # 本文
INK2 = colors.HexColor('#49515f')       # 補助説明
MUTED = colors.HexColor('#8b939f')      # 注記・ヘッダフッタ
NAVY = colors.HexColor('#1f3a5f')       # 章・見出し・表の見出し（この本の基調色）
ACCENT = colors.HexColor('#2f5c8c')     # 運用の目安（青系）
WARN = colors.HexColor('#8e2323')       # 必ず守るルール（赤系）
OK = colors.HexColor('#1f6b45')         # 合格・独り立ち（緑系）
LINE = colors.HexColor('#d2d7de')       # 細い罫
LINE2 = colors.HexColor('#a9b2be')      # 太めの罫・記入欄の罫
BAND = colors.HexColor('#eef1f5')       # 薄い地色
ZEBRA = colors.HexColor('#f6f8fa')      # 表の交互の地色（ごく薄く）
HEAD_BG = NAVY                          # 表の見出し行
EMPH = '#1f3a5f'                        # 文中の強調（色）
EMPH_BG = '#dde6f1'                     # 文中の強調（うすい下地）

# ───────── 版面（A4 210×297mm） ─────────
MARGIN_X = 17 * mm
MARGIN_TOP = 14 * mm
MARGIN_BOTTOM = 14 * mm
W = 210 * mm - MARGIN_X * 2             # 本文の幅 ＝ 176mm
BOX = '□'                               # ☐ はフォントに無いので □ を使う

S = {}
# 行の余白を足す量（pt）。1章＝見開き2ページの管理職育成のように、
# ページに余りが出る本で set_room() を呼び、行間と記入欄を広く取るために使う。
ROOM = 0.0
# 太字で組む見出し用のスタイル名
BOLD_KINDS = {'title', 'lead', 'h1', 'chtitle', 'h2', 'h3', 'cellh', 'cellb',
              'centerh', 'badge', 'toc'}

_STATE = {'section': ''}                # いま何章を組んでいるか（ヘッダに出す）


def _extend_kinsoku():
    """
    行頭・行末に置いてはいけない文字を足す（禁則処理）。
    ReportLab の表は半角の記号しか見ていないため、全角の
    「？」「！」「）」などが行頭にぽつんと落ちてしまう。
    """
    from reportlab.lib import textsplit as _ts
    if '？' in _ts.ALL_CANNOT_START:
        return
    _ts.ALL_CANNOT_START += '？！，．：；）」』】〉》〕｝”’'
    _ts.ALL_CANNOT_END += '（「『【〈《〔｛“‘'


_extend_kinsoku()


def set_room(pt=1.6):
    """1ページに余裕がある本で、表の行とチェック欄をゆったりさせる。"""
    global ROOM
    ROOM = pt


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a[len(name) + 3:]
    return default


# ============================================================
#  フォント登録
# ============================================================
def _register_noto():
    """Noto Sans CJK JP の Regular/Bold を登録する。(成功したか, 失敗の理由)"""
    missing = [p for p in (NOTO_REGULAR, NOTO_BOLD) if not os.path.exists(p)]
    if missing:
        return False, f'ファイルが無い: {", ".join(missing)}'
    try:
        for name, path in (('JP', NOTO_REGULAR), ('JP-Bold', NOTO_BOLD)):
            pdfmetrics.registerFont(TTFont(name, path, subfontIndex=NOTO_INDEX))
            pdfmetrics.getFont(name)          # 実際に読めるかここで確かめる
    except Exception as e:                    # noqa: BLE001 - 理由を残して戻す
        return False, f'{type(e).__name__}: {e}'
    pdfmetrics.registerFontFamily('JP', normal='JP', bold='JP-Bold',
                                  italic='JP', boldItalic='JP-Bold')
    return True, ''


def _register_ipa(why):
    """IPAゴシックへ確実に戻す。太字は擬似太字で作る。"""
    path = next((p for p in IPA_FONTS if os.path.exists(p)), None)
    if not path:
        sys.exit('日本語フォントが見つかりません（fonts-ipafont-gothic を入れてください）')
    pdfmetrics.registerFont(TTFont('JP', path))
    pdfmetrics.registerFontFamily('JP', normal='JP', bold='JP', italic='JP', boldItalic='JP')
    print(f'[handbook] 太字フォントを使えません（{why}）。'
          f'IPAゴシック＋擬似太字で作ります。', file=sys.stderr)
    return path


def register_fonts():
    """本文と太字のフォントを用意する。戻り値は (本文フォントのパス, 本物の太字か)。"""
    global FONT_B, HAS_BOLD, FONT_FILE
    ok, why = _register_noto()
    if ok:
        FONT_B, HAS_BOLD, FONT_FILE = 'JP-Bold', True, NOTO_REGULAR
    else:
        FONT_B, HAS_BOLD = 'JP', False
        FONT_FILE = _register_ipa(why)
    return FONT_FILE, HAS_BOLD


def check_glyphs(text):
    """フォントに無い文字が混ざっていないかを確認する（PDFでは空白になるため）。"""
    path = FONT_FILE or next((p for p in IPA_FONTS if os.path.exists(p)), None)
    if not path:
        return []
    try:
        import pymupdf
        f = pymupdf.Font(fontfile=path)
        return sorted({c for c in str(text) if ord(c) > 0x7f and not f.has_glyph(ord(c))})
    except Exception:                          # noqa: BLE001 - 確認できないだけ
        return []


# ============================================================
#  太字（本物が無ければ輪郭を重ねて太らせる）
# ============================================================
class Bold(Paragraph):
    """太字の段落。本物の太字が無いときは輪郭を重ね描きして太らせる。"""

    def draw(self):
        if HAS_BOLD:
            return Paragraph.draw(self)
        c = self.canv
        c.saveState()
        c._code.append('2 Tr')                 # 塗り＋輪郭＝擬似太字
        c.setLineWidth(self.style.fontSize * BOLD_STROKE)
        c.setLineJoin(1)
        c.setLineCap(1)
        c.setStrokeColor(self.style.textColor)
        Paragraph.draw(self)
        c.restoreState()


class RuleHead(Bold):
    """
    下に罫を1本引く大見出し（巻末資料の見出しなど）。
    描いたときにヘッダの走り書き（いま何のページか）も更新する。
    """

    def draw(self):
        _STATE['section'] = self.getPlainText()
        Bold.draw(self)
        c = self.canv
        c.saveState()
        c.setStrokeColor(NAVY)
        c.setLineWidth(1.3)
        c.line(0, -3.2, self.width, -3.2)
        c.restoreState()


class BarHead(Bold):
    """左に紺の縦帯を立てる節見出し。サイズ・太さ・色・帯で本文と差を付ける。"""

    def draw(self):
        Bold.draw(self)
        c = self.canv
        c.saveState()
        c.setFillColor(NAVY)
        c.rect(0, 1.2, 2.8, self.height - 2.4, stroke=0, fill=1)
        c.restoreState()


class SectionMark(Flowable):
    """ページのヘッダに出す「いまの章」を記録するだけの、高さ0の部品。"""

    def __init__(self, text):
        Flowable.__init__(self)
        self.text = text
        self.width = self.height = 0

    def wrap(self, aw, ah):
        return (0, 0)

    def draw(self):
        _STATE['section'] = self.text


# ============================================================
#  文字スタイル
# ============================================================
def init():
    """フォントを登録して、文字スタイルを用意する。各スクリプトの最初に呼ぶ。"""
    global ROOM
    register_fonts()
    ROOM = 0.0
    _STATE['section'] = ''
    # wordWrap='CJK' で、ReportLab の日本語向け行分け（禁則処理）が効く。
    # 「。」「？」などが行頭に来たり、1文字だけ next 行に落ちたりするのを防ぐ。
    reg = dict(fontName=FONT, textColor=INK, wordWrap='CJK')
    bld = dict(fontName=FONT_B, textColor=INK, wordWrap='CJK')
    S.clear()
    S.update({
        # 表紙
        'title': ParagraphStyle('t', **{**bld, 'fontSize': 24, 'leading': 32,
                                        'textColor': NAVY, 'spaceAfter': 3}),
        'subtitle': ParagraphStyle('st', **{**reg, 'fontSize': 11.5, 'leading': 18,
                                            'textColor': INK2}),
        'lead': ParagraphStyle('ld', **{**bld, 'fontSize': 12.5, 'leading': 19.5,
                                        'textColor': NAVY}),
        # 見出し
        'h1': ParagraphStyle('h1', **{**bld, 'fontSize': 15.5, 'leading': 21,
                                      'textColor': NAVY, 'spaceBefore': 2, 'spaceAfter': 7}),
        'chtitle': ParagraphStyle('ct1', **{**bld, 'fontSize': 16, 'leading': 21,
                                            'textColor': NAVY, 'spaceAfter': 1}),
        'h2': ParagraphStyle('h2', **{**bld, 'fontSize': 11.2, 'leading': 15.4,
                                      'textColor': NAVY, 'spaceBefore': 5.6, 'spaceAfter': 2.2,
                                      'leftIndent': 5.4 * mm}),
        'h3': ParagraphStyle('h3', **{**bld, 'fontSize': 10.4, 'leading': 15}),
        # 本文
        'body': ParagraphStyle('b', **{**reg, 'fontSize': 10, 'leading': 16.2,
                                       'spaceAfter': 3, 'alignment': TA_LEFT}),
        'small': ParagraphStyle('s', **{**reg, 'fontSize': 9.2, 'leading': 14.6,
                                        'textColor': INK2}),
        'note': ParagraphStyle('n', **{**reg, 'fontSize': 8.6, 'leading': 13.6,
                                       'textColor': MUTED}),
        'ctext': ParagraphStyle('cx', **{**reg, 'fontSize': 9.7, 'leading': 15.4}),
        # 表の中
        'cell': ParagraphStyle('c', **{**reg, 'fontSize': 9.1, 'leading': 13.6}),
        'cellb': ParagraphStyle('cb', **{**bld, 'fontSize': 9.1, 'leading': 13.6}),
        'cellh': ParagraphStyle('ch', **{**bld, 'fontSize': 9.1, 'leading': 13.6,
                                         'textColor': colors.white}),
        'center': ParagraphStyle('cc', **{**reg, 'fontSize': 9.1, 'leading': 13.6,
                                          'alignment': TA_CENTER}),
        'centerh': ParagraphStyle('cch', **{**bld, 'fontSize': 9.1, 'leading': 13.6,
                                            'textColor': colors.white, 'alignment': TA_CENTER}),
        'num': ParagraphStyle('nm', **{**bld, 'fontSize': 9.6, 'leading': 13.6,
                                       'textColor': NAVY, 'alignment': TA_RIGHT}),
        'badge': ParagraphStyle('bd', **{**bld, 'fontSize': 12.5, 'leading': 16,
                                         'textColor': colors.white, 'alignment': TA_CENTER}),
        'toc': ParagraphStyle('tc', **{**bld, 'fontSize': 10, 'leading': 14.4,
                                       'textColor': NAVY}),
        'big': ParagraphStyle('bg', **{**reg, 'fontSize': 11, 'leading': 17}),
    })
    return S


def emph(text):
    """文中の <b>〜</b> を強調に変える。"""
    t = str(text)
    if HAS_BOLD:
        return t
    # 太字が無いときは「濃い紺＋うすい下地」で、色が飛ぶ白黒印刷でも差が残るようにする
    return (t.replace('<b>', f'<font color="{EMPH}" backColor="{EMPH_BG}">')
             .replace('</b>', '</font>'))


def P(text, kind='body'):
    cls = {'h1': RuleHead, 'h2': BarHead}.get(kind)
    if cls is None:
        cls = Bold if kind in BOLD_KINDS else Paragraph
    return cls(emph(text), S[kind])


def _cell(text, kind='cell'):
    cls = Bold if kind in BOLD_KINDS else Paragraph
    return cls(emph(text), S[kind])


# ============================================================
#  表
# ============================================================
def table(rows, widths, header=True, zebra=True, row_h=None, align=None):
    """
    1行目を見出しにする表。align は中央ぞろえにする列番号のリスト。

    罫線は「縦罫なし・横罫は細く1本」まで引き算し、
    行の高さとパディングで読み取りやすくしています。
    """
    align = set(align or [])
    data = []
    for i, row in enumerate(rows):
        is_head = header and i == 0
        line = []
        for col, c in enumerate(row):
            if is_head:
                kind = 'centerh' if col in align else 'cellh'
            else:
                kind = 'center' if col in align else 'cell'
            line.append(_cell(c, kind))
        data.append(line)

    heights = None
    if row_h:
        heights = ([None] + [row_h] * (len(data) - 1)) if header else [row_h] * len(data)
    t = Table(data, colWidths=widths, rowHeights=heights, repeatRows=1 if header else 0,
              hAlign='LEFT')

    body0 = 1 if header else 0
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 3.4 + ROOM),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.4 + ROOM),
        ('LINEBELOW', (0, body0), (-1, -2), 0.35, LINE),
        ('LINEBELOW', (0, -1), (-1, -1), 0.9, LINE2),
    ]
    if row_h:
        # 行の高さを決めてある表＝手で書き込む欄。罫をはっきりさせ、
        # 中身が空のままの列（記入欄）は縦罫で仕切って書く場所を示す。
        cmds[-2] = ('LINEBELOW', (0, body0), (-1, -2), 0.6, LINE2)
        for col in range(1, len(rows[0])):
            if all(not str(r[col]).strip() for r in rows[body0:]):
                cmds.append(('LINEBEFORE', (col, body0), (col, -1), 0.6, LINE2))
    if header:
        cmds += [('BACKGROUND', (0, 0), (-1, 0), HEAD_BG),
                 ('VALIGN', (0, 0), (-1, 0), 'MIDDLE'),
                 ('TOPPADDING', (0, 0), (-1, 0), 4.4),
                 ('BOTTOMPADDING', (0, 0), (-1, 0), 4.4)]
    else:
        cmds.append(('LINEABOVE', (0, 0), (-1, 0), 0.9, LINE2))
    if zebra:
        for i in range(body0, len(data)):
            if i % 2 == (1 if header else 0):
                cmds.append(('BACKGROUND', (0, i), (-1, i), ZEBRA))
    t.setStyle(TableStyle(cmds))
    return t


# ============================================================
#  囲み・ラベル
# ============================================================
def callout(title, body, color=ACCENT):
    """色帯つきの囲み。途中でページが割れないようにまとめて置く。"""
    head = ParagraphStyle('cot', parent=S['h3'], textColor=color, spaceAfter=2.5)
    inner = [[[Bold(emph(title), head), Paragraph(emph(body), S['ctext'])]]]
    t = Table(inner, colWidths=[W], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BAND),
        ('LINEBEFORE', (0, 0), (0, -1), 3.2, color),
        ('LEFTPADDING', (0, 0), (-1, -1), 9),
        ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return KeepTogether([t])


def _band_style(color):
    """
    「必ず守ること」「目安」「合格の判定」の帯の見た目。
    白黒でも見分けられるよう、色ごとに"形"を変えています。
      赤（固定）  ＝ ベタ塗り＋白ヌキ文字（いちばん濃い）
      緑（合格）  ＝ 白地＋太い囲み罫
      青（目安）  ＝ うすい地＋左の縦帯
    """
    cmds = [('LEFTPADDING', (0, 0), (-1, 0), 9),
            ('RIGHTPADDING', (0, 0), (-1, 0), 9),
            ('TOPPADDING', (0, 0), (-1, 0), 3.8),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 3.8)]
    if color is WARN:
        style = ParagraphStyle('bl', parent=S['h3'], textColor=colors.white)
        cmds.append(('BACKGROUND', (0, 0), (-1, 0), color))
    elif color is OK:
        style = ParagraphStyle('bl', parent=S['h3'], textColor=color)
        cmds += [('LINEABOVE', (0, 0), (-1, 0), 1.2, color),
                 ('LINEBELOW', (0, 0), (-1, 0), 1.2, color)]
    else:
        style = ParagraphStyle('bl', parent=S['h3'], textColor=color)
        cmds += [('BACKGROUND', (0, 0), (-1, 0), BAND),
                 ('LINEBEFORE', (0, 0), (0, 0), 3.2, color)]
    return style, cmds


def band_label(text, color=INK2):
    """帯だけを単独で置きたいとき（中身は別で組む）。"""
    style, cmds = _band_style(color)
    t = Table([[Bold(emph(text), style)]], colWidths=[W], hAlign='LEFT')
    if color is OK:
        cmds.append(('BOX', (0, 0), (-1, 0), 1.2, color))
    t.setStyle(TableStyle(cmds))
    return t


def rule_block(text, items, color=ACCENT, mark='・'):
    """帯（見出し）と中身の箇条書きを1つの塊にする。帯と中身が離れないようにする。"""
    style, cmds = _band_style(color)
    box = mark == BOX
    mark_w = 7.2 * mm if box else 5.4 * mm
    ms = ParagraphStyle('mk', parent=S['cell'], alignment=TA_CENTER,
                        fontSize=12 if box else 10.5, textColor=color)
    rows = [[Bold(emph(text), style), '']]
    rows += [[Paragraph(mark, ms), Paragraph(emph(it), S['cell'])] for it in items]
    t = Table(rows, colWidths=[mark_w, W - mark_w], hAlign='LEFT')
    t.setStyle(TableStyle(cmds + [
        ('SPAN', (0, 0), (-1, 0)),
        ('LEFTPADDING', (0, 1), (0, -1), 2),
        ('RIGHTPADDING', (0, 1), (0, -1), 0),
        ('LEFTPADDING', (1, 1), (1, -1), 2),
        ('TOPPADDING', (0, 1), (-1, 1), 4),
        ('TOPPADDING', (0, 2), (-1, -1), 2.3 + ROOM),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 2.3 + ROOM),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BOX', (0, 0), (-1, -1), 1.2, color) if color is OK
        else ('LINEBELOW', (0, -1), (-1, -1), 0.9, LINE),
    ]))
    return KeepTogether([t])


# ============================================================
#  箇条書き・番号つき・チェック欄
# ============================================================
def bullets(items, mark='・'):
    """中黒（または□）を左に出して、2行目以降を字下げそろえにする。"""
    box = mark == BOX
    mark_w = 7.2 * mm if box else 5.4 * mm
    ms = ParagraphStyle('mk', parent=S['cell'], alignment=TA_CENTER,
                        fontSize=12 if box else 10.5,
                        textColor=NAVY if box else INK2)
    rows = [[Paragraph(mark, ms), Paragraph(emph(it), S['cell'])] for it in items]
    t = Table(rows, colWidths=[mark_w, W - mark_w], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (0, -1), 2),
        ('RIGHTPADDING', (0, 0), (0, -1), 0),
        ('LEFTPADDING', (1, 0), (1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2.3 + ROOM),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.3 + ROOM),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return t


def numbered(items):
    """手順。番号を紺の太字にし、罫線は引かず余白で区切る。"""
    rows = [[Bold(f'{i}.', S['num']), Paragraph(emph(it), S['cell'])]
            for i, it in enumerate(items, 1)]
    t = Table(rows, colWidths=[8.5 * mm, W - 8.5 * mm], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (0, -1), 2),
        ('RIGHTPADDING', (0, 0), (0, -1), 3),
        ('LEFTPADDING', (1, 0), (1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5 + ROOM),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5 + ROOM),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return t


def checkboxes(items, judge=False, judge_label='◯×', row_h=6.2 * mm):
    """□つきの一覧。judge=True なら右に◯×の記入欄を付ける。"""
    if not judge:
        return bullets(items, mark=BOX)
    bw, jw = 7.2 * mm, 26 * mm
    ms = ParagraphStyle('mk', parent=S['cell'], alignment=TA_CENTER,
                        fontSize=12, textColor=NAVY)
    head = ParagraphStyle('jh', parent=S['cellb'], alignment=TA_CENTER, textColor=NAVY)
    rows = [[Paragraph('', S['cell']), Paragraph('', S['cell']), Bold(judge_label, head)]]
    rows += [[Paragraph(BOX, ms), Paragraph(emph(it), S['cell']), Paragraph('', S['cell'])]
             for it in items]
    t = Table(rows, colWidths=[bw, W - bw - jw, jw], hAlign='LEFT',
              rowHeights=[None] + [row_h + ROOM * 1.4] * len(items))
    t.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (0, -1), 2),
        ('RIGHTPADDING', (0, 0), (0, -1), 0),
        ('LEFTPADDING', (1, 0), (1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 3.2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.2),
        ('TOPPADDING', (0, 0), (-1, 0), 3),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 3),
        ('VALIGN', (0, 1), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 1), (1, -2), 0.35, LINE),
        ('LINEBELOW', (0, -1), (1, -1), 0.9, LINE2),
        ('LINEBELOW', (0, 0), (1, 0), 0.9, LINE2),
        ('BACKGROUND', (2, 0), (2, 0), BAND),
        ('BACKGROUND', (2, 1), (2, -1), colors.white),
        ('BOX', (2, 0), (2, -1), 0.9, LINE2),
        ('INNERGRID', (2, 1), (2, -1), 0.35, LINE),
    ]))
    return t


def write_lines(n=3, label='', label_w=38 * mm, height=9 * mm):
    height += ROOM
    """手で書き込むための空欄。印刷して書けるだけの高さを取る。"""
    rows = [[Bold(label, S['cellb']) if (i == 0 and label) else Paragraph('', S['cell']),
             Paragraph('', S['cell'])] for i in range(n)]
    t = Table(rows, colWidths=[label_w, W - label_w], rowHeights=[height] * n, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 0.6, LINE2),
        ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    return t


def words_table(rows, head=('むずかしい言葉', 'かんたんに言うと', 'たとえると')):
    """難しい言葉に、やさしい説明と たとえ を付けた表。"""
    body = [[a, b, c] for a, b, c in rows]
    return table([list(head)] + body, [36 * mm, (W - 36 * mm) * 0.52, (W - 36 * mm) * 0.48])


def terms_table(rows, head=('用語', '意味')):
    """用語と意味だけの表（2列）。"""
    return table([list(head)] + [[a, b] for a, b in rows], [44 * mm, W - 44 * mm])


def trouble_table(rows, head=('こんなとき（つまずきやすい）', 'こうする')):
    return table([list(head)] + [[a, b] for a, b in rows], [W * 0.42, W * 0.58])


# ============================================================
#  ページの枠（ヘッダ・フッタ・ノンブル）
# ============================================================
def make_doc(out_path, title, running_head, author='O2ジム'):
    from datetime import date
    doc = BaseDocTemplate(
        out_path, pagesize=A4,
        leftMargin=MARGIN_X, rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP, bottomMargin=MARGIN_BOTTOM,
        title=title, author=author,
    )
    x0, x1 = MARGIN_X, 210 * mm - MARGIN_X
    today = date.today().isoformat()

    def header_footer(canvas, d):
        # ページの中身を描き終えてから呼ばれるので、その page の章名が入っている
        canvas.saveState()
        top = 297 * mm - MARGIN_TOP + 2.6 * mm          # 罫の高さ
        canvas.setFont(FONT, 8)
        canvas.setFillColor(INK2)
        canvas.drawString(x0, top + 1.8 * mm, _STATE['section'] or running_head)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(x1, top + 1.8 * mm, running_head if _STATE['section'] else today)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(x0, top, x1, top)
        canvas.setStrokeColor(NAVY)                     # 左端だけ濃くして基調色を効かせる
        canvas.setLineWidth(1.6)
        canvas.line(x0, top, x0 + 24 * mm, top)

        foot = MARGIN_BOTTOM - 7.5 * mm
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(x0, foot + 5 * mm, x1, foot + 5 * mm)
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(x0, foot, today)
        canvas.setFont(FONT, 9.5)
        canvas.setFillColor(NAVY)
        canvas.drawCentredString(105 * mm, foot, str(d.page))
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id='p', frames=[
        Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f',
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)],
        onPageEnd=header_footer)])
    return doc


# ============================================================
#  章の見出し（番号バッジ）
# ============================================================
def chapter_head(badge, title, lead=None, color=NAVY, solid=True):
    """番号バッジ＋章名＋一行説明。下に太い罫を1本引いて章の始まりを示す。"""
    bw = 22 * mm
    right = [P(title, 'chtitle')]
    if lead:
        right.append(P(lead, 'small'))
    bs = S['badge'] if solid else ParagraphStyle('bd2', parent=S['badge'], textColor=color)
    t = Table([[Bold(badge, bs), right]], colWidths=[bw, W - bw], hAlign='LEFT')
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (0, 0), 1.5),
        ('RIGHTPADDING', (0, 0), (0, 0), 1.5),
        ('LEFTPADDING', (1, 0), (1, 0), 5.5 * mm),
        ('RIGHTPADDING', (1, 0), (1, 0), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 3.4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4.2),
        ('LINEBELOW', (0, 0), (-1, -1), 1.8 if solid else 0.9, color),
    ]
    if solid:
        cmds.append(('BACKGROUND', (0, 0), (0, 0), color))
    else:
        cmds.append(('BOX', (0, 0), (0, 0), 0.9, color))
    t.setStyle(TableStyle(cmds))
    return t


# ============================================================
#  表紙・目次
# ============================================================
def cover(F, meta, chapters=None, per_row=2):
    """表紙＋目次。chapters を渡すと目次を2列で並べる。"""
    F.append(Spacer(1, 10 * mm))
    F.append(_bar(46 * mm, 4.5))
    F.append(Spacer(1, 5 * mm))
    F.append(P(meta['title'], 'title'))
    F.append(P(meta['subtitle'], 'subtitle'))
    F.append(Spacer(1, 6 * mm))
    F.append(callout(meta['lead'], meta['target'], NAVY))
    rev = meta.get('revision')
    if rev:
        # 大手の標準テキストと同じく、版数と承認の欄を表紙に置く
        F.append(Spacer(1, 3 * mm))
        F.append(table([['版数', '改訂日', '改訂理由', '作成', '承認', '次回見直し'],
                        [f"第{rev.get('version', '1.0')}版", rev.get('date', ''),
                         rev.get('reason', ''), rev.get('author', ''),
                         rev.get('approver', ''), rev.get('next_review', '')]],
                       [18 * mm, 24 * mm, W - 18 * mm - 24 * mm - 22 * mm - 30 * mm - 26 * mm,
                        22 * mm, 30 * mm, 26 * mm], align=[0, 1, 3, 4, 5]))
    F.append(Spacer(1, 7 * mm))
    if chapters:
        F.append(P(f'目次（全{len(chapters)}章）', 'h1'))
        F.append(SectionMark(''))      # 表紙のヘッダは本のタイトルのままにする
        rows = []
        for i in range(0, len(chapters), per_row):
            pair = chapters[i:i + per_row]
            cells = []
            for c in pair:
                cells += [_cell(c['no'], 'toc'), [P(c['title'], 'toc'), P(c['lead'], 'small')]]
            while len(cells) < per_row * 2:
                cells += ['', '']
            rows.append(cells)
        cw = []
        for _ in range(per_row):
            cw += [8 * mm, W / per_row - 8 * mm]
        t = Table(rows, colWidths=cw, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LINEBELOW', (0, 0), (-1, -2), 0.35, LINE),
            ('LINEBELOW', (0, -1), (-1, -1), 0.9, LINE2),
        ]))
        F.append(t)


def _bar(width, height, color=NAVY):
    """表紙の飾り罫。"""
    t = Table([['']], colWidths=[width], rowHeights=[height], hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), color)]))
    return t


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
    F.append(SectionMark(f'第{c["no"]}章　{c["title"]}'))
    head = [chapter_head(f'第{c["no"]}章', c['title'], c['lead'])]
    if c.get('oneline'):
        head += [Spacer(1, 2 * mm), callout('ひとことで言うと', c['oneline'])]
    head += [P(L['goal'], 'h2'), P(c['goal'])]
    F.append(KeepTogether(head))

    # 用語の説明は2列（用語・意味）でも3列（＋たとえ）でもよい
    wt = words_table(words) if len(words[0]) == 3 else terms_table(words)
    F.append(KeepTogether([P(L['words'], 'h2'), wt]))
    F.append(KeepTogether([P(L['steps'], 'h2'), numbered(c['steps'])]))

    if split and c.get('trouble'):
        F.append(KeepTogether([P(L['trouble'], 'h2'), trouble_table(c['trouble'])]))
        F.append(PageBreak())
        F.append(chapter_head(f'第{c["no"]}章', f'{c["title"]}（つづき）', L['cont'], solid=False))
        F.append(Spacer(1, 1.5 * mm))

    F.append(Spacer(1, 1.2 * mm))
    F.append(rule_block(L['fixed'], c['fixed'], WARN))
    F.append(Spacer(1, 1.2 * mm))
    F.append(rule_block(L['guides'], c['guides'], ACCENT))

    F.append(P(L['checks'], 'h2'))
    F.append(checkboxes(c['checks'], judge=True))

    F.append(Spacer(1, 1.2 * mm))
    F.append(rule_block(L['solo'], c['solo'], OK, mark=BOX))

    if c.get('trouble') and not split:
        F.append(Spacer(1, 1.5 * mm))
        F.append(KeepTogether([P(L['trouble'], 'h2'), trouble_table(c['trouble'])]))
    if c.get('homework'):
        F.append(Spacer(1, 1.5 * mm))
        F.append(KeepTogether([
            P('宿題（次に会うまでに、実際にやってみる）', 'h2'),
            checkboxes(c['homework'], judge=True, judge_label='できた'),
            Spacer(1, 1.5 * mm),
            write_lines(3, 'やってみて気づいたこと')]))
    if page_break:
        F.append(PageBreak())
