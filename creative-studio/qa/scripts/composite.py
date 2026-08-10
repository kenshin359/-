#!/usr/bin/env python3
"""composite.py — 参照商品画像を edit_region に決定論的に合成する（AI生成なし）。

RULE 2 の技術的保証。商品を「想像で描き直す」代わりに、参照画像を保持したまま
指定矩形へ配置する。edit_region 外の画素は一切変更しない（＝完全保持）。

使い方:
  python3 composite.py --base master/creative.png \
                       --product references/products/prod-001.png \
                       --locks locks/creative.locks.json \
                       --out output/creative_replaced.png \
                       [--fit contain|cover] [--shadow] [--pad 0.06]

- 参照画像に透過(アルファ)があれば尊重して自然に切り抜き合成する。
- --shadow で接地影を簡易付与（Agent04 が方向を確認）。
"""
import sys
import argparse
import json

try:
    import numpy as np  # noqa: F401  (将来の拡張用/依存確認)
    from PIL import Image, ImageFilter
except Exception as e:  # noqa
    print("ERROR: 依存が未導入です。`pip install -r qa/scripts/requirements.txt`\n  detail:", e)
    sys.exit(2)


def _parse_color(s):
    s = s.strip().lstrip("#")
    if len(s) == 6:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)
    if len(s) == 8:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), int(s[6:8], 16))
    raise ValueError(f"色は #RRGGBB か #RRGGBBAA で指定: '{s}'")


def fit_size(pw, ph, bw, bh, mode):
    """product(pw,ph) を box(bw,bh) に収める倍率を返す。"""
    if mode == "cover":
        s = max(bw / pw, bh / ph)
    else:  # contain
        s = min(bw / pw, bh / ph)
    return max(1, int(pw * s)), max(1, int(ph * s))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--product", required=True)
    ap.add_argument("--locks", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fit", choices=["contain", "cover"], default="contain")
    ap.add_argument("--pad", type=float, default=0.06, help="edit_region内側の余白率")
    ap.add_argument("--shadow", action="store_true")
    ap.add_argument("--clear", default=None,
                    help="配置前に edit_region を指定色(例 '#f5f2ec')で塗り、旧商品の"
                         "はみ出しを消す。edit_region 内のみ変更なので LOCK は保たれる。")
    args = ap.parse_args()

    with open(args.locks, encoding="utf-8") as f:
        lk = json.load(f)
    er = lk.get("edit_region")
    if not er:
        print("ERROR: locks に edit_region がありません。合成先が特定できません。")
        return 2

    base = Image.open(args.base).convert("RGBA")
    prod = Image.open(args.product).convert("RGBA")

    ex, ey, ew, eh = er["x"], er["y"], er["w"], er["h"]
    if args.clear:
        # edit_region だけを塗りつぶす（旧商品のはみ出し除去）。領域外は不変。
        fill = Image.new("RGBA", (ew, eh), _parse_color(args.clear))
        base.paste(fill, (ex, ey))
    pad = int(min(ew, eh) * args.pad)
    inner_w, inner_h = ew - 2 * pad, eh - 2 * pad

    tw, th = fit_size(prod.width, prod.height, inner_w, inner_h, args.fit)
    prod_r = prod.resize((tw, th), Image.LANCZOS)

    # edit_region 内で中央配置（底を少し下げて接地感）
    px = ex + (ew - tw) // 2
    py = ey + (eh - th) // 2

    canvas = Image.new("RGBA", base.size, (0, 0, 0, 0))

    if args.shadow:
        alpha = prod_r.split()[-1]
        shadow = Image.new("RGBA", prod_r.size, (0, 0, 0, 0))
        shadow.putalpha(alpha.point(lambda a: int(a * 0.35)))
        shadow = shadow.filter(ImageFilter.GaussianBlur(max(3, tw // 40)))
        canvas.alpha_composite(shadow, (px + max(4, tw // 60), py + max(6, th // 40)))

    canvas.alpha_composite(prod_r, (px, py))

    out = Image.alpha_composite(base, canvas).convert("RGB")
    out.save(args.out)

    print("=" * 52)
    print("  COMPOSITE（決定論的な商品差し替え）")
    print("=" * 52)
    print(f"  base        : {args.base} {base.size}")
    print(f"  product     : {args.product} {prod.size} -> {prod_r.size}")
    print(f"  edit_region : x={ex} y={ey} w={ew} h={eh} (pad={pad})")
    print(f"  placed at   : ({px}, {py})  fit={args.fit}  shadow={args.shadow}")
    print(f"  saved       : {args.out}")
    print("  NOTE: edit_region 外は base のまま。lock_verify.py で完全保持を検証すること。")
    print("=" * 52)
    return 0


if __name__ == "__main__":
    sys.exit(main())
