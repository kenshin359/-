#!/usr/bin/env python3
"""diff_check.py — Before/After の差分を定量化し、変化領域とヒートマップを出力する。

使い方:
  python3 diff_check.py <before.png> <after.png> [--heatmap out.png] [--threshold 2]

出力: 変化画素率、変化領域の外接矩形(bbox)、（任意で）ヒートマップPNG。
"""
import sys
import argparse

try:
    import numpy as np
    from PIL import Image
except Exception as e:  # noqa
    print("ERROR: 依存が未導入です。`pip install -r qa/scripts/requirements.txt`\n  detail:", e)
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("before")
    ap.add_argument("after")
    ap.add_argument("--heatmap", default=None)
    ap.add_argument("--threshold", type=int, default=2, help="変化とみなす画素差(0-255)")
    args = ap.parse_args()

    a = np.asarray(Image.open(args.before).convert("RGB"), dtype=np.int16)
    b = np.asarray(Image.open(args.after).convert("RGB"), dtype=np.int16)
    if a.shape != b.shape:
        print(f"FAIL: サイズが異なります before={a.shape} after={b.shape}")
        return 1

    h, w = a.shape[:2]
    dist = np.abs(a - b).max(axis=2)
    changed = dist > args.threshold
    n = int(changed.sum())
    total = h * w

    print("=" * 52)
    print("  DIFF CHECK")
    print("=" * 52)
    print(f"  canvas         : {w} x {h}  ({total} px)")
    print(f"  threshold      : {args.threshold}")
    print(f"  changed px     : {n}  ({n/total*100:.4f}%)")
    print(f"  max pixel delta: {int(dist.max())}")
    print(f"  mean delta     : {dist.mean():.3f}")

    if n:
        ys, xs = np.where(changed)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        print(f"  change bbox    : x0={bbox[0]} y0={bbox[1]} x1={bbox[2]} y1={bbox[3]}"
              f"  (w={bbox[2]-bbox[0]+1}, h={bbox[3]-bbox[1]+1})")
    else:
        print("  change bbox    : なし（完全一致）")

    if args.heatmap:
        norm = (dist.clip(0, 255)).astype(np.uint8)
        vis = np.zeros((h, w, 3), dtype=np.uint8)
        vis[..., 0] = norm            # 差が大きいほど赤
        base = (a.mean(axis=2) * 0.25).astype(np.uint8)
        vis[..., 1] = np.where(changed, 0, base)
        vis[..., 2] = np.where(changed, 0, base)
        Image.fromarray(vis).save(args.heatmap)
        print(f"  heatmap saved  : {args.heatmap}")

    print("=" * 52)
    return 0


if __name__ == "__main__":
    sys.exit(main())
