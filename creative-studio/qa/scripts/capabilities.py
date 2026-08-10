#!/usr/bin/env python3
"""capabilities.py — この環境で「本当に使える」画像処理手段を検証して出力する。

存在しない/未接続の手段を「使える」と偽らないための正直な棚卸し。
使い方: python3 qa/scripts/capabilities.py
"""
import importlib
import shutil
import os
import sys


def check_import(mod):
    try:
        m = importlib.import_module(mod)
        return True, getattr(m, "__version__", "ok")
    except Exception as e:
        return False, str(e).split("\n")[0]


def check_cli(name):
    path = shutil.which(name)
    return (path is not None), (path or "not found")


def check_chromium():
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")
    if not root or not os.path.isdir(root):
        return False, "PLAYWRIGHT_BROWSERS_PATH unset or missing"
    entries = [d for d in os.listdir(root) if "chromium" in d.lower()]
    return (len(entries) > 0), ", ".join(entries) if entries else "no chromium dir"


def main():
    print("=" * 60)
    print("  AD CREATIVE STUDIO — 利用可能手段の検証")
    print("=" * 60)

    rows = []
    for mod in ["PIL", "numpy", "playwright"]:
        ok, info = check_import(mod)
        rows.append((f"python:{mod}", ok, info))

    for cli in ["ffmpeg", "magick", "convert", "exiftool", "node"]:
        ok, info = check_cli(cli)
        rows.append((f"cli:{cli}", ok, info))

    ok, info = check_chromium()
    rows.append(("chromium(playwright)", ok, info))

    # 外部画像生成APIは環境変数キーが無ければ使えない（偽装しない）
    gen_key = any(os.environ.get(k) for k in
                  ["IMAGE_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "STABILITY_API_KEY"])
    rows.append(("external image-gen API key", gen_key,
                 "set" if gen_key else "未設定 — 生成は不可（キーを渡せば可）"))

    for name, ok, info in rows:
        mark = "✅" if ok else "❌"
        print(f"  {mark}  {name:<28} {info}")

    print("-" * 60)
    can_pixel = check_import("PIL")[0] and check_import("numpy")[0]
    can_text = check_chromium()[0] and check_import("playwright")[0]
    print("  決定論的ピクセル編集/差分/LOCK検証:", "可能" if can_pixel else "不可(pip install -r requirements.txt)")
    print("  日本語文字レイヤーのHTML→PNG:", "可能" if can_text else "要 playwright（pip install playwright）")
    print("  AI画像生成:", "外部APIキー提供時のみ" if not gen_key else "APIキー検出")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
