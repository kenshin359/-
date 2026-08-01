#!/usr/bin/env python3
"""最終通告書の Markdown を、日本語フォント埋め込みのPDFへ変換する。

influencer-notices/ 内の各 .md（README/テンプレート含む可）を
influencer-notices/pdf/<同名>.pdf に出力する。
"""
import os
import re
import glob
import html

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

FONT = "HeiseiKakuGo-W5"  # reportlab 内蔵の日本語ゴシック（フォントファイル不要）
pdfmetrics.registerFont(UnicodeCIDFont(FONT))

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "pdf")
os.makedirs(OUT_DIR, exist_ok=True)

styles = {
    "title": ParagraphStyle("title", fontName=FONT, fontSize=17, leading=24,
                             alignment=TA_CENTER, spaceBefore=6, spaceAfter=14),
    "h2": ParagraphStyle("h2", fontName=FONT, fontSize=12, leading=18,
                          spaceBefore=8, spaceAfter=4),
    "body": ParagraphStyle("body", fontName=FONT, fontSize=10.5, leading=18,
                           alignment=TA_LEFT, spaceAfter=4),
    "right": ParagraphStyle("right", fontName=FONT, fontSize=10, leading=16,
                            alignment=TA_RIGHT, spaceAfter=0),
    "center": ParagraphStyle("center", fontName=FONT, fontSize=10.5, leading=18,
                             alignment=TA_CENTER, spaceAfter=2),
    "bullet": ParagraphStyle("bullet", fontName=FONT, fontSize=10.5, leading=17,
                             leftIndent=14, spaceAfter=2),
    "note": ParagraphStyle("note", fontName=FONT, fontSize=9, leading=14,
                           textColor="#555555", spaceBefore=2, spaceAfter=2),
}


def inline(text):
    """**bold** → <b>bold</b>、XML特殊文字をエスケープ。"""
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    return text


def md_to_flowables(lines):
    flow = []
    in_note = False  # 末尾の「送付メモ」欄（--- 以降）
    for raw in lines:
        line = raw.rstrip("\n")
        stripped = line.strip()

        if stripped == "":
            flow.append(Spacer(1, 5))
            continue

        if stripped.startswith("# "):
            flow.append(Paragraph(inline(stripped[2:].strip()), styles["title"]))
            continue

        if stripped.startswith("## ") or stripped.startswith("**") and stripped.endswith("**") and re.match(r"^\*\*\d", stripped):
            flow.append(Paragraph(inline(stripped.lstrip("# ").strip()), styles["h2"]))
            continue

        if stripped.startswith("---"):
            flow.append(Spacer(1, 6))
            flow.append(HRFlowable(width="100%", thickness=0.6, color="#999999"))
            in_note = True
            continue

        # 「記」は中央寄せ
        if stripped == "記":
            flow.append(Paragraph("記", styles["center"]))
            continue

        # 右寄せ（発信者ブロック：全角スペースで字下げされた行）
        if raw.startswith("　　　") or raw.startswith("      "):
            flow.append(Paragraph(inline(stripped), styles["right"]))
            continue

        # 送付メモ（※で始まる注記）
        if stripped.startswith("※") or in_note:
            flow.append(Paragraph(inline(stripped), styles["note"]))
            continue

        # 箇条書き
        if stripped.startswith("- "):
            flow.append(Paragraph("・" + inline(stripped[2:]), styles["bullet"]))
            continue
        m = re.match(r"^(\d+)\.\s+(.*)", stripped)
        if m:
            flow.append(Paragraph(f"{m.group(1)}．" + inline(m.group(2)), styles["bullet"]))
            continue

        flow.append(Paragraph(inline(stripped), styles["body"]))
    return flow


def convert(md_path):
    name = os.path.splitext(os.path.basename(md_path))[0]
    out_path = os.path.join(OUT_DIR, name + ".pdf")
    with open(md_path, encoding="utf-8") as f:
        lines = f.readlines()
    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        leftMargin=22 * mm, rightMargin=22 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
        title=name,
    )
    doc.build(md_to_flowables(lines))
    return out_path


def main():
    targets = sorted(glob.glob(os.path.join(BASE, "*.md")))
    # README とテンプレートは通告書ではないので除外（必要なら含める）
    skip = {"README", "_テンプレート"}
    made = []
    for md in targets:
        base = os.path.splitext(os.path.basename(md))[0]
        if base in skip:
            continue
        made.append(convert(md))
    for p in made:
        print("created:", p)


if __name__ == "__main__":
    main()
