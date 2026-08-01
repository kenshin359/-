#!/usr/bin/env python3
"""連絡先・期日・法的措置の文面を全書面に統一反映する。"""
import glob
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))

# 発信者ブロック
REPL_SIMPLE = [
    ("担当者：【担当者名】", "担当者：西岡　美咲"),
    ("連絡先：【電話】／【メール】", "連絡先：06-77777-2443／libetee@libetee.co.jp"),
]

# 統一する「4. 期限内にご回答なき場合」の本文
NEW_SEC4 = (
    "誠に遺憾ながら、当社は本件を弁護士に正式に依頼し、"
    "**内容証明郵便の送付を含む法的措置**に移行いたします。"
    "具体的には、**本件契約の解除、提供済み商品相当額"
    "（および受領済みの報酬・インセンティブがある場合はその額）の返還請求、"
    "これに伴う損害賠償請求、ならびに訴訟の提起**を予定しております。"
    "これらの手続に要する弁護士費用・遅延損害金等についても、"
    "貴殿にご負担いただく場合があります。"
)


def process(text):
    for a, b in REPL_SIMPLE:
        text = text.replace(a, b)

    # 所在地の行は住所未提供のため削除（郵送時に追記）
    text = re.sub(r"\n[　\s]*所在地：【会社所在地】", "", text)

    # 3. 回答期限：相対期限 → 確定日 2026年8月15日
    text = re.sub(
        r"本通知到達後\*\*7日以内（【[　\s]*年[　\s]*月[　\s]*日】まで）\*\*に",
        "**2026年8月15日**までに",
        text,
    )
    # 2. 求める対応 内の相対期限
    text = text.replace("本通知到達後7日以内に", "2026年8月15日までに")

    # 4. 法的措置の本文を統一・明確化
    text = re.sub(
        r"誠に遺憾ながら、当社は弁護士に依頼のうえ、[^\n]*?ご負担が生じる可能性があります。",
        NEW_SEC4,
        text,
    )
    return text


def main():
    files = sorted(glob.glob(os.path.join(BASE, "0*.md")))
    files.append(os.path.join(BASE, "_テンプレート.md"))
    for f in files:
        with open(f, encoding="utf-8") as fh:
            src = fh.read()
        out = process(src)
        with open(f, "w", encoding="utf-8") as fh:
            fh.write(out)
        print("updated:", os.path.basename(f))


if __name__ == "__main__":
    main()
