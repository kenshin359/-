# -*- coding: utf-8 -*-
"""Sei-Kin / Quiet Gold — business card for 北野 拳慎 / 株式会社リベティ
Japanese standard 91x55mm, 3mm bleed, 600dpi print-ready PDF + preview PNGs."""
from PIL import Image, ImageDraw, ImageFont

# ---------- geometry ----------
DPI = 600
SS = 2                      # supersample for crisp type
TRIM_W, TRIM_H = 91.0, 55.0
BLEED = 3.0
def mm(v):                  # mm -> supersampled px
    return v * DPI / 25.4 * SS
W = int(round(mm(TRIM_W + 2 * BLEED)))
H = int(round(mm(TRIM_H + 2 * BLEED)))
OFF = mm(BLEED)             # trim origin inside bleed

# ---------- palette ----------
IVORY   = (243, 238, 227)
IVORY_D = (232, 224, 208)
INK     = (28, 35, 49)      # sumi indigo-black
INK_DEEP= (19, 26, 38)
GOLD    = (170, 135, 72)
GOLD_HI = (201, 169, 107)
CINNABAR= (179, 58, 45)
SMOKE   = (146, 137, 116)
SMOKE_B = (120, 130, 148)   # cool smoke for dark bg

FD = "/home/user/-/business-card/"
def F(name, pt):            # pt -> supersampled px font
    px = pt * DPI / 72.0 * SS
    return ImageFont.truetype(FD + name, int(round(px)))

# fonts
MIN_R = "ShipporiMincho-Regular.ttf"
MIN_S = "ShipporiMincho-SemiBold.ttf"
MIN_B = "ShipporiMincho-Bold.ttf"
LAT_D = "Italiana-Regular.ttf"     # elegant high-fashion caps
LAT_G = "Gloock-Regular.ttf"       # high-contrast display serif
LAT_C = "CrimsonPro-Regular.ttf"

# ---------- text helpers ----------
def text_w(draw, s, font, tracking=0.0):
    if not s:
        return 0
    w = sum(draw.textlength(c, font=font) for c in s)
    return w + tracking * (len(s) - 1)

def draw_tracked(draw, xy, s, font, fill, tracking=0.0, mid_v=False):
    x, y = xy
    if mid_v:
        asc, desc = font.getmetrics()
        y = y - (asc + desc) / 2
    for c in s:
        draw.text((x, y), c, font=font, fill=fill)
        x += draw.textlength(c, font=font) + tracking

def draw_center(draw, cx, y, s, font, fill, tracking=0.0):
    w = text_w(draw, s, font, tracking)
    draw_tracked(draw, (cx - w / 2, y), s, font, fill, tracking)
    return w

# ---------- vermilion hanko seal ----------
def make_seal(px, chars, edge=CINNABAR):
    im = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lw = max(2, int(px * 0.05))
    d.rounded_rectangle([lw, lw, px - lw, px - lw], radius=int(px * 0.05),
                        outline=edge, width=lw)
    fs = int(px * 0.42)
    fnt = ImageFont.truetype(FD + MIN_B, fs)
    n = len(chars)
    pad = px * 0.15
    cell = (px - 2 * pad) / n
    for i, c in enumerate(chars):
        bb = fnt.getbbox(c)
        cw, ch = bb[2] - bb[0], bb[3] - bb[1]
        d.text((px / 2 - cw / 2 - bb[0], pad + cell * (i + 0.5) - ch / 2 - bb[1]),
               c, font=fnt, fill=edge)
    return im

# =====================================================================
# FRONT
# =====================================================================
def front():
    img = Image.new("RGB", (W, H), IVORY)
    d = ImageDraw.Draw(img)

    ml = OFF + mm(7.5)
    mr = OFF + mm(TRIM_W - 7.5)
    top = OFF + mm(7)
    bot = OFF + mm(TRIM_H - 7)

    spine_x = OFF + mm(TRIM_W * 0.635)
    d.line([(spine_x, top + mm(0.5)), (spine_x, bot - mm(7.5))], fill=GOLD, width=max(1, int(SS * 1.2)))

    # company (top-left)
    draw_tracked(d, (ml, top - mm(0.5)), "株式会社リベティ", F(MIN_S, 8.4), INK, tracking=mm(0.7))
    draw_tracked(d, (ml + mm(0.3), top + mm(5.2)), "L I B E T Y   I N C .", F(LAT_D, 6.0), GOLD, tracking=mm(0.6))

    # name (focal point, center-left)
    name_y = OFF + mm(TRIM_H * 0.5) - mm(4)
    draw_tracked(d, (ml, name_y), "北野　拳慎", F(MIN_R, 15.5), INK, tracking=mm(0.9))
    draw_tracked(d, (ml + mm(0.6), name_y + mm(9.4)), "K I T A N O   K E N S H I N",
                 F(LAT_D, 6.6), SMOKE, tracking=mm(0.5))

    # title (right of spine)
    draw_tracked(d, (spine_x + mm(4.2), top - mm(0.2)), "取締役", F(MIN_R, 9.2), INK, tracking=mm(0.8))
    draw_tracked(d, (spine_x + mm(4.4), top + mm(5.6)), "D I R E C T O R", F(LAT_D, 5.6), GOLD, tracking=mm(0.5))

    # seal (right column) — optically centered between spine and right margin,
    # vertically aligned with the name
    seal_mm = 13.5
    seal_px = int(mm(seal_mm))
    seal = make_seal(seal_px, "北野")
    col_l = spine_x + mm(4.2)
    col_r = mr
    seal_x = col_l + ((col_r - col_l) - mm(seal_mm)) / 2
    seal_y = name_y + mm(1.5)
    img.paste(seal, (int(seal_x), int(seal_y)), seal)

    # address (bottom)
    d.line([(ml, bot - mm(5.6)), (mr, bot - mm(5.6))], fill=IVORY_D, width=max(1, int(SS)))
    draw_tracked(d, (ml, bot - mm(3.4)), "大阪府大阪市中央南船場 4-3　心斎橋東急ビル 5F",
                 F(MIN_R, 6.2), INK, tracking=mm(0.3))
    return img

# =====================================================================
# BACK
# =====================================================================
def back():
    img = Image.new("RGB", (W, H), INK_DEEP)
    d = ImageDraw.Draw(img)
    cx, cy = W / 2, H / 2

    # inset double hairline frame
    fm = OFF + mm(4)
    d.rectangle([fm, fm, W - fm, H - fm], outline=(58, 68, 86), width=max(1, int(SS)))
    fm2 = fm + mm(1.1)
    d.rectangle([fm2, fm2, W - fm2, H - fm2], outline=(44, 53, 70), width=max(1, int(SS * 0.8)))

    # monogram L (high-contrast serif) in gold
    mono = F(LAT_G, 40)
    lw = text_w(d, "L", mono)
    asc, desc = mono.getmetrics()
    d.text((cx - lw / 2, cy - mm(15)), "L", font=mono, fill=GOLD)

    # small gold rule under monogram
    d.line([(cx - mm(6), cy + mm(6.5)), (cx + mm(6), cy + mm(6.5))], fill=GOLD, width=max(1, int(SS)))

    # company name centered
    co_y = cy + mm(9)
    cow = draw_center(d, cx, co_y, "株式会社リベティ", F(MIN_R, 9.4), GOLD_HI, tracking=mm(1.3))

    # latin lockup
    draw_center(d, cx, co_y + mm(6.6), "L I B E T Y   I N C O R P O R A T E D",
                F(LAT_D, 5.6), SMOKE_B, tracking=mm(0.9))
    return img

# =====================================================================
def finish(img, name):
    small = img.resize((W // SS, H // SS), Image.LANCZOS)
    small.save(FD + name, dpi=(DPI, DPI))
    return small

f_img = finish(front(), "card_front.png")
b_img = finish(back(),  "card_back.png")
f_img.save(FD + "business_card.pdf", "PDF", resolution=DPI,
           save_all=True, append_images=[b_img])
print("done", f_img.size, "->",
      round(f_img.size[0] / DPI * 25.4, 1), "x", round(f_img.size[1] / DPI * 25.4, 1), "mm")
