#!/usr/bin/env python3
"""layout_render.py — 日本語文字レイヤーを HTML/CSS で正確にレンダリングし透過PNG化。

RULE 6: 日本語文字を画像生成モデル任せにしない。背景/商品を先に作り、
文字は最終工程でこのツールで**正確に**載せる。Chromium(Playwright)で描画するため
文字化け・誤字・字形崩れが原理的に起きない。

使い方:
  python3 layout_render.py --html layer.html --out output/text_layer.png \
      --width 1080 --height 1920 [--over background.png --composite out.png]

- --html: 透過背景のHTML（body{background:transparent}）。日本語Webフォント可。
- --over + --composite: 生成した文字レイヤーを背景に重ねた合成も出力。
"""
import sys
import argparse
import os
import glob


def _find_chromium():
    """環境に既存の Chromium 実体を探す。無ければ None（playwright既定に委ねる）。"""
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
    patterns = [
        os.path.join(root, "chromium-*/chrome-linux/chrome"),
        os.path.join(root, "chromium_headless_shell-*/chrome-linux/headless_shell"),
    ]
    for pat in patterns:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1920)
    ap.add_argument("--over", default=None, help="背景PNG（重ねる場合）")
    ap.add_argument("--composite", default=None, help="重ね合わせ結果の出力先")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # noqa
        print("ERROR: playwright 未導入。`pip install playwright`（Chromiumは環境に既存・"
              "playwright install は不要）\n  detail:", e)
        return 2

    url = "file://" + os.path.abspath(args.html)
    # この環境では pre-install 済み Chromium のビルド番号が pip の playwright と
    # ずれることがある。存在する実体を探して executable_path で直接指す
    # （`playwright install` は環境ポリシー上不要かつ非推奨）。
    exe = _find_chromium()
    launch_kwargs = {"executable_path": exe} if exe else {}
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs)
        page = browser.new_page(viewport={"width": args.width, "height": args.height},
                                device_scale_factor=1)
        page.goto(url)
        page.wait_for_timeout(200)  # Webフォント適用待ち
        page.screenshot(path=args.out, omit_background=True)
        browser.close()
    print(f"  text layer saved: {args.out} ({args.width}x{args.height})")

    if args.over and args.composite:
        try:
            from PIL import Image
        except Exception as e:  # noqa
            print("  合成にはPillowが必要:", e)
            return 2
        bg = Image.open(args.over).convert("RGBA")
        tx = Image.open(args.out).convert("RGBA")
        if bg.size != tx.size:
            tx = tx.resize(bg.size, Image.LANCZOS)
        Image.alpha_composite(bg, tx).convert("RGB").save(args.composite)
        print(f"  composited      : {args.composite}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
