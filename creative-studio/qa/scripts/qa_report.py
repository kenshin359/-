#!/usr/bin/env python3
"""qa_report.py — QAを統合実行し、Markdownレポート＋100点採点の雛形を出力する。

実行する機械チェック:
  1. 日付と曜日の整合性（RULE 5）— 推測でなく暦で照合
  2. LOCK検証（lock_verify.py）— 指定時
  3. Before/After差分（diff_check.py）— master/output 指定時

使い方:
  python3 qa_report.py --out output/creative/qa_report.md \
     [--master master/c.png --output output/c.png --locks locks/c.locks.json] \
     [--date 2026-08-15=金 --date 2026-08-16=土] \
     [--price "1,980円" --product-name "商品名"]

曜日は「月火水木金土日」または英語(Mon..Sun)で指定可。
"""
import sys
import argparse
import subprocess
import datetime
import os

JP_WD = ["月", "火", "水", "木", "金", "土", "日"]      # Monday=0
EN_WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def check_date_weekday(spec):
    """'2026-08-15=金' を暦と照合。(ok, message) を返す。"""
    try:
        date_s, claimed = spec.split("=", 1)
        d = datetime.date.fromisoformat(date_s.strip())
    except Exception:
        return False, f"日付の形式が不正: '{spec}'（例: 2026-08-15=金）"
    actual_jp = JP_WD[d.weekday()]
    actual_en = EN_WD[d.weekday()]
    claimed = claimed.strip().rstrip("曜日")
    ok = claimed in (actual_jp, actual_en) or claimed.lower() == actual_en.lower()
    if ok:
        return True, f"{date_s} は {actual_jp}曜日 → 記載『{claimed}』OK"
    return False, f"{date_s} は正しくは {actual_jp}曜日（{actual_en}）。記載『{claimed}』は誤り！"


def run_script(script, script_args):
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, script)
    try:
        r = subprocess.run([sys.executable, path] + script_args,
                           capture_output=True, text=True)
        return r.returncode, (r.stdout + r.stderr)
    except Exception as e:  # noqa
        return 2, f"実行失敗: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--master", default=None)
    ap.add_argument("--output", default=None)
    ap.add_argument("--locks", default=None)
    ap.add_argument("--date", action="append", default=[], help="YYYY-MM-DD=曜日 を複数可")
    ap.add_argument("--price", default=None)
    ap.add_argument("--product-name", default=None)
    args = ap.parse_args()

    lines = []
    overall_pass = True

    def add(s=""):
        lines.append(s)

    add("# QA レポート")
    add(f"- 生成: qa_report.py")
    add("")

    # 1. 日付曜日
    add("## 1. 日付・曜日の整合性（RULE 5）")
    if args.date:
        for spec in args.date:
            ok, msg = check_date_weekday(spec)
            overall_pass &= ok
            add(f"- {'✅' if ok else '❌'} {msg}")
    else:
        add("- （日付指定なし — 画像に日付/曜日があるなら --date で必ず検証すること）")
    add("")

    # 2. LOCK 検証
    add("## 2. LOCK 検証（SURGICAL EDIT 合否）")
    if args.master and args.output and args.locks:
        code, out = run_script("lock_verify.py",
                               [args.master, args.output, args.locks])
        overall_pass &= (code == 0)
        add("```")
        add(out.rstrip())
        add("```")
    else:
        add("- （--master --output --locks 未指定でスキップ）")
    add("")

    # 3. 差分
    add("## 3. Before/After 差分")
    if args.master and args.output:
        code, out = run_script("diff_check.py", [args.master, args.output])
        add("```")
        add(out.rstrip())
        add("```")
    else:
        add("- （--master --output 未指定でスキップ）")
    add("")

    # 参考メタ（推測混入を防ぐため事実のみ転記）
    add("## 4. 事実の転記（推測禁止 — 指定値のみ）")
    add(f"- 商品名: {args.product_name or '(未指定)'}")
    add(f"- 価格: {args.price or '(未指定)'}")
    add("- ※ ここに値が無いのに画像へ価格/機能を書いていたら RULE 4 違反。")
    add("")

    # 100点スコア雛形
    add("## 5. Final 100 Point Score（≥95で提出可）")
    add("| 項目 | 配点 | 得点 | 根拠 |")
    add("|---|---:|---:|---|")
    for name, pt in [("商品再現精度", 25), ("デザイン完成度", 20), ("情報伝達力", 15),
                     ("タイポグラフィ", 10), ("ブランド整合性", 10),
                     ("広告成果期待値", 10), ("技術的完成度", 5), ("誤字/指示遵守", 5)]:
        add(f"| {name} | {pt} | | |")
    add("| **合計** | **100** | | |")
    add("")

    add("## 6. 機械チェック総合")
    add(f"- **{'✅ PASS' if overall_pass else '❌ FAIL'}**"
        " （日付曜日＋LOCKの自動判定。主観採点は各Agentが記入）")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print("\n".join(lines))
    print(f"\n[saved] {args.out}")
    return 0 if overall_pass else 1


if __name__ == "__main__":
    sys.exit(main())
