#!/usr/bin/env python3
# ============================================================
#  トレーナー研修ハンドブック（PDF）の生成
# ------------------------------------------------------------
#  SNS研修ハンドブックと同じ体裁で、パーソナルジムの新人研修用に作ります。
#  各章の構成は固定：
#    1.ゴール 2.用語・前提 3.手順 4.必ず守る社内ルール（固定）
#    5.運用の目安（状況で変更可） 6.チェックリスト 7.独り立ち判定
#
#  入力: config/gym-handbook.json（文面はすべてここ）
#  出力: out/トレーナー研修ハンドブック.pdf
#    表紙＋目次＋研修スケジュール（30日）＋1日の流れ＋全8章
#    ＋巻末資料（研修チェック表・言い方の型・緊急時フロー・まとめテスト＋解答）
#
#  実行:
#    npm run handbook:gym
#    python3 scripts/buildGymHandbook.py --store=梅田店
#
#  ★この環境には日本語の太字フォントが無いため、強調は「色」で表現します
#    （buildSnsHandbook.py と同じ方針）。
# ============================================================
import json
import os
import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph,
    Spacer, Table, TableStyle,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONT_REG = '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf'
FONT_ALT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
FONT_ALT2 = '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf'

INK = colors.HexColor('#1a1a19')
INK2 = colors.HexColor('#52514e')
MUTED = colors.HexColor('#898781')
ACCENT = colors.HexColor('#2a78d6')
WARN = colors.HexColor('#d03b3b')
OK = colors.HexColor('#1f7a4d')
LINE = colors.HexColor('#d8d7d0')
BAND = colors.HexColor('#f1f1ed')
EMPH = '#123c78'          # 太字が使えないため、強調は暗い青で表す
W = 165 * mm              # 本文の幅

S = None


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a[len(name) + 3:]
    return default


def register_fonts():
    path = next((p for p in (FONT_REG, FONT_ALT, FONT_ALT2) if os.path.exists(p)), None)
    if not path:
        sys.exit('日本語フォントが見つかりません（fonts-ipafont-gothic を入れてください）')
    pdfmetrics.registerFont(TTFont('JP', path))
    pdfmetrics.registerFont(TTFont('JP-B', path))


def styles():
    getSampleStyleSheet()
    base = dict(fontName='JP', textColor=INK, leading=15.5)
    return {
        'title': ParagraphStyle('t', **{**base, 'fontSize': 22, 'leading': 29, 'spaceAfter': 4}),
        'subtitle': ParagraphStyle('st', **{**base, 'fontSize': 11, 'leading': 17, 'textColor': INK2}),
        'lead': ParagraphStyle('ld', **{**base, 'fontSize': 12, 'leading': 18, 'textColor': colors.HexColor(EMPH)}),
        'h1': ParagraphStyle('h1', **{**base, 'fontSize': 15.5, 'leading': 20, 'spaceBefore': 8, 'spaceAfter': 2}),
        'h2': ParagraphStyle('h2', **{**base, 'fontSize': 11, 'leading': 15, 'spaceBefore': 6, 'spaceAfter': 2}),
        'body': ParagraphStyle('b', **{**base, 'fontSize': 9.2, 'leading': 13.8, 'spaceAfter': 3, 'alignment': TA_LEFT}),
        'small': ParagraphStyle('s', **{**base, 'fontSize': 8.8, 'leading': 13.5, 'textColor': INK2}),
        'note': ParagraphStyle('n', **{**base, 'fontSize': 8.5, 'leading': 13, 'textColor': MUTED}),
        'cell': ParagraphStyle('c', **{**base, 'fontSize': 8.5, 'leading': 12.2}),
        'cellh': ParagraphStyle('ch', **{**base, 'fontSize': 8.5, 'leading': 12.2, 'textColor': colors.white}),
        'center': ParagraphStyle('ct', **{**base, 'fontSize': 8.5, 'leading': 12.2, 'alignment': TA_CENTER}),
    }


def emph(text):
    return str(text).replace('<b>', f'<font color="{EMPH}">').replace('</b>', '</font>')


def P(text, kind='body'):
    return Paragraph(emph(text), S[kind])


def table(rows, widths, header=True, zebra=True, row_h=None, align=None):
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
        cmds.append(('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3d3d3a')))
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if i % 2 == (1 if header else 0):
                cmds.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#fafaf7')))
    if align:
        for col in align:
            cmds.append(('ALIGN', (col, 0), (col, -1), 'CENTER'))
    t.setStyle(TableStyle(cmds))
    return t


def callout(title, body, color=ACCENT):
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


def checkboxes(items, judge=False):
    """□つきのチェックリスト。judge=True なら ◯×の記入欄を右に付ける。"""
    if judge:
        rows = [[Paragraph('', S['cell']), Paragraph('<font color="%s">◯×</font>' % EMPH, S['center'])]]
        rows += [[Paragraph(emph(f'□　{it}'), S['cell']), Paragraph('', S['cell'])] for it in items]
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
    return bullets(items, mark='□')


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


# ------------------------------------------------------------
#  1章ぶんの組み立て
# ------------------------------------------------------------
def chapter(F, c):
    F.append(KeepTogether([
        P(f'第{c["no"]}章　{c["title"]}', 'h1'),
        P(c['lead'], 'small'),
        Spacer(1, 2 * mm),
        P('1. ゴール', 'h2'),
        P(c['goal'])]))

    F.append(KeepTogether([
        P('2. 用語・前提', 'h2'),
        table([['用語', '意味']] + [[a, b] for a, b in c['terms']], [42 * mm, W - 42 * mm])]))

    F.append(KeepTogether([
        P('3. 手順（この順で進める）', 'h2'),
        numbered(c['steps'])]))

    F.append(Spacer(1, 1.5 * mm))
    F.append(KeepTogether([band_label('4. 必ず守る社内ルール（固定）', WARN),
                           Spacer(1, 1 * mm), bullets(c['fixed'])]))
    F.append(Spacer(1, 1.5 * mm))
    F.append(KeepTogether([band_label('5. 運用の目安（状況で変更可）', ACCENT),
                           Spacer(1, 1 * mm), bullets(c['guides'])]))

    F.append(P('6. チェックリスト（研修担当が◯×判定）', 'h2'))
    F.append(checkboxes(c['checks'], judge=True))

    F.append(Spacer(1, 1.5 * mm))
    F.append(KeepTogether([band_label('7. 独り立ち判定（3つ全て）', OK),
                           Spacer(1, 1 * mm), bullets(c['solo'], mark='□')]))
    F.append(PageBreak())


def build(cfg, out):
    global S
    register_fonts()
    S = styles()
    meta = cfg['meta']

    def header_footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('JP', 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 287 * mm, f'{meta["company"]}｜{meta["title"]}')
        canvas.drawRightString(190 * mm, 287 * mm, date.today().isoformat())
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.4)
        canvas.line(20 * mm, 285 * mm, 190 * mm, 285 * mm)
        canvas.drawCentredString(105 * mm, 12 * mm, f'— {doc.page} —')
        canvas.restoreState()

    doc = BaseDocTemplate(
        out, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=24 * mm, bottomMargin=20 * mm,
        title=meta['title'], author=meta['company'],
    )
    doc.addPageTemplates([PageTemplate(id='p', frames=[
        Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')], onPage=header_footer)])

    F = []

    # ───────── 表紙 ─────────
    F.append(Spacer(1, 6 * mm))
    F.append(P(meta['title'], 'title'))
    F.append(P(meta['subtitle'], 'subtitle'))
    F.append(Spacer(1, 3 * mm))
    F.append(P(meta['lead'], 'lead'))
    F.append(P(meta['target'], 'small'))
    F.append(Spacer(1, 5 * mm))

    F.append(P('目次（全8章）', 'h2'))
    rows = []
    chs = cfg['chapters']
    for i in range(0, len(chs), 2):
        pair = chs[i:i + 2]
        left = f'<b>{pair[0]["no"]} {pair[0]["title"]}</b><br/>{pair[0]["lead"]}'
        right = (f'<b>{pair[1]["no"]} {pair[1]["title"]}</b><br/>{pair[1]["lead"]}'
                 if len(pair) > 1 else '')
        rows.append([left, right])
    F.append(table(rows, [W / 2, W / 2], header=False, zebra=False))

    F.append(Spacer(1, 4 * mm))
    for title, body in cfg['legend']:
        F.append(callout(title, body, WARN if '固定' in title else ACCENT))
        F.append(Spacer(1, 2 * mm))
    F.append(P(cfg['legend_note'], 'note'))
    F.append(PageBreak())

    F.append(KeepTogether([
        P('研修スケジュール（30日でLv2＝ひとりで店に立てる状態へ）', 'h2'),
        table([['期間', 'この期間でやること（対応する章）', 'この期間の到達基準']]
              + [[a, b, c] for a, b, c in cfg['schedule']],
              [22 * mm, 78 * mm, W - 100 * mm])]))

    F.append(KeepTogether([
        P('1日の流れ（どの章がどこで効くか）', 'h2'),
        table([['時間帯', 'やること', '章']]
              + [[a, b, c] for a, b, c in cfg['flow']],
              [24 * mm, W - 44 * mm, 20 * mm], align=[2])]))
    F.append(Spacer(1, 4 * mm))
    F.append(callout('この研修の進め方',
                     '①→⑧の順に進めます。<b>②安全管理だけは初日に必ず終わらせます</b>。'
                     '各章は「手順どおりにやってみる → チェックリストを研修担当が◯×で判定 → '
                     '独り立ち判定3つが全て◯」で先へ進みます。'
                     '分からないまま長時間止まらず、早めに相談してください。'))
    F.append(PageBreak())

    # ───────── 全8章 ─────────
    for c in cfg['chapters']:
        chapter(F, c)

    # ───────── 巻末資料 ─────────
    F.append(P('巻末資料①　研修チェック表（本人・研修担当）', 'h1'))
    F.append(P('章ごとに、本人が「できる」と思うか／研修担当が◯×で判定したかを記録します。'
               '独り立ち判定は各章の7を使います。', 'small'))
    F.append(table([['章', 'この章のゴール', '本人', '担当', '判定日']]
                   + [[f'{c["no"]} {c["title"]}', c['lead'], '', '', '']
                      for c in cfg['chapters']],
                   [40 * mm, W - 40 * mm - 54 * mm, 14 * mm, 14 * mm, 26 * mm],
                   row_h=11 * mm, align=[2, 3]))
    F.append(Spacer(1, 4 * mm))
    F.append(callout('独り立ち（Lv2到達）の条件',
                     '全8章のチェックリストが◯で埋まり、②安全管理・⑤トレーニング指導・'
                     '⑧事務・記録の<b>独り立ち判定3つが全て□→◯</b>になったら、'
                     '責任者が単独シフトに入れる判断をします。'
                     '30日で届かない場合は、本人ではなく<b>教育計画を作り直します</b>。', OK))
    F.append(PageBreak())

    F.append(P('巻末資料②　言い方の型（この言い方はしない／こう言う）', 'h1'))
    F.append(P('料金・返金・医療にかかわる言い方は、店の信頼と法律に直結します。'
               '迷ったら「確認してから答える」が正解です。', 'small'))
    F.append(table([['× この言い方はしない', '◯ こう言う']]
                   + [[a, b] for a, b in cfg['phrases']], [W / 2, W / 2]))

    F.append(P('巻末資料③　緊急時の動き（ケガ・体調不良）', 'h1'))
    F.append(table([['順', 'やること', 'いつまでに']]
                   + [[a, b, c] for a, b, c in cfg['emergency']],
                   [12 * mm, W - 46 * mm, 34 * mm], align=[0]))
    F.append(Spacer(1, 3 * mm))
    F.append(callout('迷ったときの原則',
                     '<b>止める・呼ぶ・残す</b>の3つです。セッションを止める、'
                     '迷ったら救急と責任者を呼ぶ、起きたことを文字で残す。'
                     '「大丈夫そうだから報告しない」が一番危険です。', WARN))
    F.append(PageBreak())

    F.append(P('巻末資料④　まとめテスト（全20問）', 'h1'))
    F.append(P('研修の最後に、書いて答えます。8割（16問）以上で合格。'
               '間違えた章はチェックリストに戻ってやり直します。', 'small'))
    F.append(table([['#', '問題', '答え（記入欄）']]
                   + [[str(i), q, ''] for i, (q, _) in enumerate(cfg['test'], 1)],
                   [10 * mm, 88 * mm, W - 98 * mm], row_h=10 * mm, align=[0]))
    F.append(PageBreak())

    F.append(P('巻末資料⑤　まとめテスト 解答（研修担当用）', 'h1'))
    F.append(table([['#', '問題', '解答']]
                   + [[str(i), q, a] for i, (q, a) in enumerate(cfg['test'], 1)],
                   [10 * mm, 72 * mm, W - 82 * mm], align=[0]))
    F.append(Spacer(1, 4 * mm))
    F.append(P(f'作成: {date.today():%Y年%m月%d日}　／　管理: {meta["manager"]}さん'
               f'　／　文面の修正は config/gym-handbook.json を直して作り直します。', 'note'))

    doc.build(F)


def main():
    cfg_path = arg('config', os.path.join(ROOT, 'config', 'gym-handbook.json'))
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    if arg('store'):
        cfg['meta']['company'] = arg('store')
    if arg('name'):
        cfg['meta']['manager'] = arg('name')
    out = arg('out', os.path.join(ROOT, 'out', 'トレーナー研修ハンドブック.pdf'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    build(cfg, out)
    print(f'できました: {out}')
    print(f'  全{len(cfg["chapters"])}章＋巻末資料5点（チェック表・言い方の型・緊急時の動き・'
          f'まとめテスト{len(cfg["test"])}問・解答）')
    print('  文面を直すときは config/gym-handbook.json を編集して作り直してください。')


if __name__ == '__main__':
    main()
