#!/usr/bin/env python3
# ============================================================
#  未返信レビューのPDFを作る
# ------------------------------------------------------------
#  scripts/reviewInbox.js が書いた out/review-inbox.json を読み、
#  CSチームがそのまま使える「返信待ちレビュー一覧」PDFにします。
#  低評価（★が少ない）ほど先頭に来ます。
#
#  実行: python3 scripts/buildReviewInboxPdf.py [入力JSON] [出力PDF]
# ============================================================
import json
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)

# 日本語フォント（reportlab内蔵のCIDフォント。フォントファイル不要）
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
JP = 'HeiseiKakuGo-W5'

src = Path(sys.argv[1] if len(sys.argv) > 1 else 'out/review-inbox.json')
dst = Path(sys.argv[2] if len(sys.argv) > 2 else 'out/review-inbox.pdf')
data = json.loads(src.read_text(encoding='utf-8'))
reviews = data['reviews']
meta = data.get('meta', {})

# 低評価が先、同じ星なら新しい順
reviews.sort(key=lambda r: (r['star'], -int(r['date'].replace('/', ''))))

title_style = ParagraphStyle('t', fontName=JP, fontSize=16, leading=22)
sub_style = ParagraphStyle('s', fontName=JP, fontSize=9.5, leading=14, textColor=colors.HexColor('#555555'))
head_style = ParagraphStyle('h', fontName=JP, fontSize=11, leading=15)
body_style = ParagraphStyle('b', fontName=JP, fontSize=10, leading=15)

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

story = []
story.append(Paragraph('返信待ちレビュー一覧（楽天ショップレビュー）', title_style))
story.append(Spacer(1, 2 * mm))
lo = sum(1 for r in reviews if r['star'] <= 3)
story.append(Paragraph(
    f"期間: {meta.get('from','')} 〜 {meta.get('to','')} ／ 未返信 {len(reviews)}件"
    f"（うち ★3以下 {lo}件・要優先対応） ／ 作成: {meta.get('generated','')}",
    sub_style,
))
story.append(Paragraph('※ 低評価のレビューほど先頭に並んでいます。返信は RMS →「レビューチェックツール」から。', sub_style))
story.append(Spacer(1, 4 * mm))

STAR_COLOR = {1: '#C92A2A', 2: '#E8590C', 3: '#E67700', 4: '#2B8A3E', 5: '#2B8A3E'}
for i, r in enumerate(reviews, 1):
    stars = '★' * r['star'] + '☆' * (5 - r['star'])
    color = STAR_COLOR[r['star']]
    head = (f"<font color='{color}'><b>{stars}</b></font>　"
            f"<b>{i}.</b> {esc(r['date'])}　{esc(r.get('who', ''))}")
    story.append(Paragraph(head, head_style))
    story.append(Spacer(1, 1.2 * mm))
    story.append(Paragraph(esc(r.get('body', '')), body_style))
    story.append(Spacer(1, 2.5 * mm))
    story.append(HRFlowable(width='100%', thickness=0.4, color=colors.HexColor('#CCCCCC')))
    story.append(Spacer(1, 2.5 * mm))

def page_no(canvas, doc):
    canvas.setFont(JP, 8)
    canvas.setFillColor(colors.HexColor('#888888'))
    canvas.drawCentredString(A4[0] / 2, 10 * mm, f'- {doc.page} -　Libetee CSレビュー返信リスト')

doc = SimpleDocTemplate(
    str(dst), pagesize=A4,
    topMargin=15 * mm, bottomMargin=18 * mm, leftMargin=15 * mm, rightMargin=15 * mm,
    title='返信待ちレビュー一覧',
)
doc.build(story, onFirstPage=page_no, onLaterPages=page_no)
print(f'PDF: {dst} ({len(reviews)}件)')
