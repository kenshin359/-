#!/usr/bin/env python3
"""lock_verify.py — LOCK領域の不変を検証する（SURGICAL EDIT MODE の合否判定）。

「一箇所修正した結果、全体が微妙に変わる」を機械的に検出する中核ツール。
edit_region の外側で tolerance を超えて変化した画素が、
max_changed_ratio_outside_edit を超えたら FAIL。

使い方:
  python3 lock_verify.py <master.png> <output.png> <locks.json> [--diff out_diff.png]

終了コード: 0 = PASS, 1 = FAIL, 2 = 実行エラー
"""
import sys
import json
import argparse

try:
    import numpy as np
    from PIL import Image
except Exception as e:  # noqa
    print("ERROR: 依存が未導入です。`pip install -r qa/scripts/requirements.txt`")
    print("  detail:", e)
    sys.exit(2)


def load_rgb(path, size=None):
    img = Image.open(path).convert("RGB")
    if size is not None and img.size != size:
        raise ValueError(f"サイズ不一致: {path} は {img.size}、期待は {size}。"
                         "master と output は同一サイズである必要があります。")
    return np.asarray(img, dtype=np.int16)


def region_mask(shape_hw, box):
    """box=[x,y,w,h] を True とするマスクを返す。"""
    h, w = shape_hw
    m = np.zeros((h, w), dtype=bool)
    x, y, bw, bh = box
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(w, x + bw), min(h, y + bh)
    if x1 > x0 and y1 > y0:
        m[y0:y1, x0:x1] = True
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master")
    ap.add_argument("output")
    ap.add_argument("locks")
    ap.add_argument("--diff", default=None, help="変化画素を可視化したPNGの出力先")
    args = ap.parse_args()

    with open(args.locks, encoding="utf-8") as f:
        lk = json.load(f)

    canvas = lk.get("canvas")
    size = (canvas["w"], canvas["h"]) if canvas else None
    tol = lk.get("tolerance", {})
    per_pixel = int(tol.get("per_pixel", 2))
    max_ratio = float(tol.get("max_changed_ratio_outside_edit", 0.0))

    a = load_rgb(args.master, size)
    b = load_rgb(args.output, a.shape[1::-1] if size is None else size)
    if a.shape != b.shape:
        print(f"FAIL: 画像サイズが異なります master={a.shape} output={b.shape}")
        return 1

    h, w = a.shape[:2]
    # 各チャンネルの絶対差の最大が per_pixel を超えた画素を「変化」とみなす
    diff = np.abs(a - b).max(axis=2)
    changed = diff > per_pixel

    # 変更を許可する領域（edit_region）
    allowed = np.zeros((h, w), dtype=bool)
    er = lk.get("edit_region")
    if er:
        allowed |= region_mask((h, w), [er["x"], er["y"], er["w"], er["h"]])

    leaked = changed & (~allowed)          # 許可外で変化した画素 = 違反
    outside_total = int((~allowed).sum())
    leaked_n = int(leaked.sum())
    leaked_ratio = (leaked_n / outside_total) if outside_total else 0.0

    print("=" * 56)
    print("  LOCK VERIFY —", lk.get("name", "(no name)"))
    print("=" * 56)
    print(f"  canvas            : {w} x {h}")
    print(f"  per_pixel tol     : {per_pixel}")
    print(f"  changed px total  : {int(changed.sum())} ({changed.mean()*100:.4f}%)")
    print(f"  edit_region       : {er if er else '未定義（全面ロック）'}")
    print(f"  leaked px (禁止域) : {leaked_n} / {outside_total}  = {leaked_ratio*100:.5f}%")
    print(f"  allowed leak      : {max_ratio*100:.5f}%")

    # LOCK個別領域の変化も参考出力
    for kind in ("text", "product", "layout"):
        for item in lk.get("locks", {}).get(kind, []):
            m = region_mask((h, w), item["box"])
            n = int((changed & m).sum())
            flag = "⚠️変化あり" if n else "不変OK"
            note = f" ref={item.get('reference')}" if item.get("reference") else ""
            print(f"    [{kind:7}] {item['name']:<14} changed={n:<7} {flag}{note}")

    if args.diff:
        vis = np.zeros((h, w, 3), dtype=np.uint8)
        vis[changed] = [255, 80, 80]        # 変化=赤
        vis[leaked] = [255, 0, 0]           # 違反=濃い赤
        if er:
            # edit_region の枠を緑で描く
            x0, y0, x1, y1 = er["x"], er["y"], er["x"]+er["w"], er["y"]+er["h"]
            for xx in range(max(0, x0), min(w, x1)):
                if 0 <= y0 < h:
                    vis[y0, xx] = [0, 255, 0]
                if 0 <= y1-1 < h:
                    vis[y1-1, xx] = [0, 255, 0]
            for yy in range(max(0, y0), min(h, y1)):
                if 0 <= x0 < w:
                    vis[yy, x0] = [0, 255, 0]
                if 0 <= x1-1 < w:
                    vis[yy, x1-1] = [0, 255, 0]
        Image.fromarray(vis).save(args.diff)
        print(f"  diff visual saved : {args.diff}")

    print("-" * 56)
    if leaked_ratio > max_ratio:
        # 違反画素の外接矩形を出す
        ys, xs = np.where(leaked)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        print(f"  RESULT: ❌ FAIL — 許可領域外で変化が漏れています bbox(x0,y0,x1,y1)={bbox}")
        print("  → SURGICAL EDIT 失敗。edit_region 外を元に戻すこと。")
        return 1
    print("  RESULT: ✅ PASS — 変更は許可領域内に収まっています。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
