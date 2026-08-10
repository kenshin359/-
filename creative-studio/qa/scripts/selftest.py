#!/usr/bin/env python3
"""selftest.py — 合成データでパイプライン全体を実行し、動作を証明する。

生成物は output/_selftest/ に出る。テストケース:
「完成済み広告のうち、商品1点だけを参照商品へ置換し、それ以外を完全保持する」
を実際に走らせ、(A) 正しい置換=PASS, (B) 領域外を触った版=FAIL を両方示す。
"""
import os
import json
import subprocess
import sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "output", "_selftest")
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1920
EDIT = {"x": 240, "y": 760, "w": 600, "h": 600}


def build_master(path):
    """合成の完成広告(Before): 見出し・ロゴ・中央に既存商品(赤い箱)。"""
    img = Image.new("RGB", (W, H), (245, 242, 236))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 220], fill=(20, 30, 60))               # ヘッダー帯
    d.text((80, 90), "SUMMER SALE", fill=(255, 255, 255))        # 見出し(TEXT LOCK対象)
    d.rectangle([60, 1770, 360, 1860], outline=(20, 30, 60), width=4)
    d.text((90, 1805), "LIBETEE", fill=(20, 30, 60))             # ロゴ(LAYOUT LOCK対象)
    # 既存商品(置換される): 赤い角丸箱
    e = EDIT
    d.rounded_rectangle([e["x"]+80, e["y"]+80, e["x"]+e["w"]-80, e["y"]+e["h"]-80],
                        radius=40, fill=(200, 60, 50))
    img.save(path)


def build_reference(path):
    """参照商品(Ground Truth): 透過PNG。青い円+白帯という『別商品』。"""
    img = Image.new("RGBA", (460, 460), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([30, 30, 430, 430], fill=(40, 90, 200, 255))
    d.rectangle([30, 210, 430, 260], fill=(255, 255, 255, 255))
    img.save(path)


def write_locks(path):
    locks = {
        "name": "selftest_story",
        "canvas": {"w": W, "h": H},
        "edit_region": EDIT,
        "locks": {
            "text": [{"name": "headline", "box": [80, 80, 500, 80]}],
            "product": [{"name": "main_product",
                         "box": [EDIT["x"], EDIT["y"], EDIT["w"], EDIT["h"]],
                         "reference": "prod-EXAMPLE"}],
            "layout": [{"name": "logo", "box": [60, 1770, 300, 90]}],
        },
        "tolerance": {"per_pixel": 2, "max_changed_ratio_outside_edit": 0.0},
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(locks, f, ensure_ascii=False, indent=2)


def run(script, argv):
    r = subprocess.run([sys.executable, os.path.join(HERE, script)] + argv,
                       capture_output=True, text=True)
    print(r.stdout, end="")
    if r.returncode != 0 and r.stderr:
        print(r.stderr, end="")
    return r.returncode


def make_bad(good_out, bad_out):
    """領域外(ロゴ)を1px改変した『違反版』を作る → lock_verify が FAIL すべき。"""
    img = Image.open(good_out).convert("RGB")
    d = ImageDraw.Draw(img)
    d.rectangle([70, 1780, 200, 1840], fill=(255, 0, 0))  # ロゴ域を塗る=領域外変更
    img.save(bad_out)


def main():
    master = os.path.join(OUT, "master.png")
    ref = os.path.join(OUT, "reference_product.png")
    locks = os.path.join(OUT, "story.locks.json")
    good = os.path.join(OUT, "replaced_good.png")
    bad = os.path.join(OUT, "replaced_bad.png")

    build_master(master)
    build_reference(ref)
    write_locks(locks)

    print("\n########## STEP 04: 決定論的な商品差し替え合成 ##########")
    run("composite.py", ["--base", master, "--product", ref, "--locks", locks,
                         "--out", good, "--fit", "contain", "--shadow"])

    print("\n########## STEP 09-a: LOCK検証（正しい置換 → PASS期待） ##########")
    ok_good = run("lock_verify.py", [master, good, locks,
                                     "--diff", os.path.join(OUT, "diff_good.png")])
    print(f"[selftest] good の lock_verify 終了コード = {ok_good} (0=PASS)")

    print("\n########## STEP 09-b: 違反版（領域外を改変 → FAIL期待） ##########")
    make_bad(good, bad)
    ok_bad = run("lock_verify.py", [master, bad, locks,
                                    "--diff", os.path.join(OUT, "diff_bad.png")])
    print(f"[selftest] bad の lock_verify 終了コード = {ok_bad} (1=FAIL期待)")

    print("\n########## STEP 09-c: 差分ヒートマップ ##########")
    run("diff_check.py", [master, good, "--heatmap", os.path.join(OUT, "heatmap_good.png")])

    print("\n########## STEP 09-d: 統合QAレポート（日付曜日検証つき） ##########")
    run("qa_report.py", ["--out", os.path.join(OUT, "qa_report.md"),
                         "--master", master, "--output", good, "--locks", locks,
                         "--date", "2026-08-15=金",      # 正しい
                         "--date", "2026-08-16=金",      # わざと誤り(本当は土)
                         "--product-name", "サンプル商品", "--price", "1,980円"])

    print("\n########## 判定 ##########")
    verdict = (ok_good == 0 and ok_bad == 1)
    print("SELFTEST:", "✅ 全チェック期待通り" if verdict else "❌ 期待外の結果")
    print(f"  - 正しい置換は PASS: {ok_good == 0}")
    print(f"  - 領域外改変は FAIL検出: {ok_bad == 1}")
    print(f"  生成物: {OUT}")
    return 0 if verdict else 1


if __name__ == "__main__":
    sys.exit(main())
